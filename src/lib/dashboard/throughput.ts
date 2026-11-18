/** Dashboard の Throughput：リポジトリごとのマージ数と、工程ごとの時間（入力は `loadTurns` の `results` だけ） */

import type { RepoResult } from "../github/types";
import { isStepLogComment, STEP_LOG_MARKER } from "../stepLog";
import { inRange, PERIOD_KEYS, periodRange, type PeriodKey } from "./period";
import { median, mergedPulls, p90, parseRunRows, time } from "./summary";

/** 工程の行（画面に出す順）。`queue` は順番待ち（`ai:queue` が付いている間） */
export const THROUGHPUT_STEPS = ["plan", "implement", "ci", "review", "fix", "queue"] as const;
export type ThroughputStep = (typeof THROUGHPUT_STEPS)[number];

/** 進捗ログの `step` → 行（`mocks`・`deploy` は出さない） */
const LOG_STEP: Record<string, ThroughputStep | undefined> = {
  plan: "plan",
  implement: "implement",
  ci: "ci",
  review: "review",
  fix: "fix",
};

/** 横棒に出すリポジトリの数 */
export const REPO_BAR_LIMIT = 5;

export type RepoMerges = { owner: string; repo: string; merged: number };

export type StepTime = {
  step: ThroughputStep;
  /** 数えた件数 */
  count: number;
  /** 所要時間（ミリ秒）の中央値と p90。件数0なら null（`—`） */
  medianMs: number | null;
  p90Ms: number | null;
};

export type Throughput = {
  /** 期間内のマージ数が多い順に最大5つ（同数は名前順）。0件のリポジトリは入れない */
  repos: RepoMerges[];
  /** 6工程の行（件数0でも行は残す） */
  steps: StepTime[];
  /** median が最大の工程。全部 null なら null */
  longest: ThroughputStep | null;
};

/** 数が取れないとき（読めたリポジトリが無い）の値 */
function empty(): Throughput {
  return {
    repos: [],
    steps: THROUGHPUT_STEPS.map((step) => ({ step, count: 0, medianMs: null, p90Ms: null })),
    longest: null,
  };
}

/** 1つの期間の Throughput。読めたリポジトリ（`ok`）だけを数える */
export function throughput(results: readonly RepoResult[], now: Date, key: PeriodKey): Throughput {
  const { start, end } = periodRange(now, key);
  const merges: RepoMerges[] = [];
  const durations: Record<ThroughputStep, number[]> = { plan: [], implement: [], ci: [], review: [], fix: [], queue: [] };
  let loadedCount = 0;

  for (const result of results) {
    if (!result.ok) continue;
    loadedCount += 1;
    const data = result.data;

    const merged = mergedPulls(data).filter((row) => inRange(row.mergedAt, start, end)).length;
    if (merged > 0) merges.push({ owner: result.owner, repo: result.repo, merged });

    for (const comment of data.comments) {
      if (!comment.body.includes(STEP_LOG_MARKER) || !isStepLogComment(comment.body)) continue;
      for (const row of parseRunRows(comment.body, now)) {
        const step = LOG_STEP[row.step];
        if (step === undefined || !inRange(row.started, start, end)) continue;
        durations[step].push(row.durationMs);
      }
    }

    // 順番待ち：`ai:queue` が付いてから外れるまで（外れていなければ「今」まで）。Issue ごとに時刻順に組にする
    const queued = data.events
      .flatMap((event) => {
        const at = time(event.createdAt);
        const isQueue = event.labelName === "ai:queue" && (event.event === "labeled" || event.event === "unlabeled");
        return isQueue && at !== null ? [{ issue: event.issueNumber, labeled: event.event === "labeled", at }] : [];
      })
      .sort((a, b) => a.at - b.at);
    const open = new Map<number | null, number>();
    for (const event of queued) {
      if (event.labeled) {
        if (!open.has(event.issue)) open.set(event.issue, event.at);
        continue;
      }
      const from = open.get(event.issue);
      if (from === undefined) continue;
      open.delete(event.issue);
      if (inRange(from, start, end)) durations.queue.push(event.at - from);
    }
    for (const from of open.values()) {
      if (inRange(from, start, end)) durations.queue.push(Math.max(0, now.getTime() - from));
    }
  }

  if (loadedCount === 0) return empty();

  merges.sort((a, b) => b.merged - a.merged || `${a.owner}/${a.repo}`.localeCompare(`${b.owner}/${b.repo}`));
  const steps = THROUGHPUT_STEPS.map((step): StepTime => {
    const sorted = [...durations[step]].sort((a, b) => a - b);
    return { step, count: sorted.length, medianMs: median(sorted), p90Ms: p90(sorted) };
  });
  return { repos: merges.slice(0, REPO_BAR_LIMIT), steps, longest: longestStep(steps) };
}

/** median が最大の工程（同じなら先の行）。全部 null なら null */
export function longestStep(steps: readonly StepTime[]): ThroughputStep | null {
  let best: StepTime | null = null;
  for (const row of steps) {
    if (row.medianMs !== null && (best === null || row.medianMs > (best.medianMs ?? 0))) best = row;
  }
  return best === null ? null : best.step;
}

/** 棒の長さの基準：行の中の最大の p90（取れた物が無ければ null） */
export function maxP90(steps: readonly StepTime[]): number | null {
  const values = steps.flatMap((row) => (row.p90Ms === null ? [] : [row.p90Ms]));
  return values.length === 0 ? null : Math.max(...values);
}

/** 全部の期間の Throughput（画面に渡す小さな値。切り替えのたびに取り直さない） */
export function throughputAll(results: readonly RepoResult[], now: Date): Record<PeriodKey, Throughput> {
  return Object.fromEntries(PERIOD_KEYS.map((key) => [key, throughput(results, now, key)])) as Record<PeriodKey, Throughput>;
}
