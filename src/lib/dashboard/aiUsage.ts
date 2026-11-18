/** Dashboard の AI usage：工程×モデルの回数と時間、`Parallel 3`・`Serial` の1件あたりの時間（入力は `loadTurns` の `results` と期間だけ） */

import { FLOW_STEPS, type FlowStepKey } from "../flow";
import type { RepoData, RepoResult } from "../github/types";
import { isLinkedPull } from "../status";
import { isStepLogComment, STEP_LOG_MARKER } from "../stepLog";
import { inRange, PERIOD_KEYS, periodRange, type PeriodKey } from "./period";
import { median, parseRunRows, time } from "./summary";

/** 表の列のモデル（`Total` は別） */
export const USAGE_MODELS = ["sonnet", "opus", "fable"] as const;
export type UsageModel = (typeof USAGE_MODELS)[number];

/** 進捗ログの `step` → 表の行（`mocks` はデザインの行にまとめる） */
const STEP_TO_ROW: Record<string, FlowStepKey> = {
  plan: "plan",
  mocks: "design",
  implement: "implement",
  ci: "ci",
  review: "review",
  fix: "fix",
  deploy: "deploy",
};

export type UsageRow = {
  step: FlowStepKey;
  /** モデルごとにAIが動いた回数（進捗ログの行数）。0 は `—` と書く */
  counts: Record<UsageModel, number>;
  /** 動いていた時間の合計（ミリ秒）。モデルが記録に無い行も入る。その工程の記録（読めた行）が1つも無ければ null（`—`） */
  totalMs: number | null;
};

export type AiUsage = {
  /** 進捗図の工程の並び（記録が1つも無い工程の行も出す） */
  rows: UsageRow[];
  /** 使用量の上限に当たった回数。今のデータからは分からないので常に null（`—`） */
  limitHits: null;
  /** `Parallel 3`：他のIssueと作業の幅が重なったIssueの、作成 → マージの中央値（ミリ秒）。数える物が無ければ null */
  parallelMs: number | null;
  /** `Serial`：どれとも重ならなかったIssueの、同じ中央値 */
  serialMs: number | null;
};

/** モデル名（`sonnet`・`claude-opus-5-5` など）を表の列に当てる。当てはまらなければ null */
export function usageModel(model: string | null): UsageModel | null {
  if (model === null) return null;
  const lower = model.toLowerCase();
  return USAGE_MODELS.find((name) => lower.includes(name)) ?? null;
}

type Span = { issue: number; start: number; end: number; leadMs: number | null; mergedAt: number };

/** 期間内にマージされたPRに紐づくIssueごとの、作業の幅（進捗ログの最初の行の開始 → マージ） */
function workSpans(data: RepoData, now: Date): Span[] {
  const spans = new Map<number, Span>();
  for (const pull of data.pulls) {
    if (!pull.merged) continue;
    const mergedAt = time(pull.mergedAt);
    if (mergedAt === null) continue;
    const issue = data.issues.find((candidate) => isLinkedPull(pull, candidate.number));
    if (!issue) continue;
    let start: number | null = null;
    for (const comment of data.comments) {
      if (comment.issueNumber !== issue.number || !comment.body.includes(STEP_LOG_MARKER)) continue;
      if (!isStepLogComment(comment.body)) continue;
      for (const row of parseRunRows(comment.body, now)) {
        if (start === null || row.started < start) start = row.started;
      }
    }
    if (start === null || start > mergedAt) continue;
    const createdAt = time(issue.createdAt);
    spans.set(issue.number, {
      issue: issue.number,
      start,
      end: mergedAt,
      mergedAt,
      leadMs: createdAt !== null && mergedAt >= createdAt ? mergedAt - createdAt : null,
    });
  }
  return [...spans.values()];
}

function overlaps(a: Span, b: Span): boolean {
  return a.start < b.end && b.start < a.end;
}

/** 1つの期間の AI usage。読めたリポジトリ（`ok`）だけを数える */
export function aiUsage(results: readonly RepoResult[], now: Date, key: PeriodKey): AiUsage {
  const { start, end } = periodRange(now, key);
  const loaded = results.flatMap((result) => (result.ok ? [result.data] : []));

  const rows: UsageRow[] = FLOW_STEPS.map(({ key: step }) => ({
    step,
    counts: { sonnet: 0, opus: 0, fable: 0 },
    totalMs: null,
  }));
  const byStep = new Map(rows.map((row) => [row.step, row]));

  const parallel: number[] = [];
  const serial: number[] = [];
  for (const data of loaded) {
    for (const comment of data.comments) {
      if (!comment.body.includes(STEP_LOG_MARKER) || !isStepLogComment(comment.body)) continue;
      for (const run of parseRunRows(comment.body, now)) {
        if (!inRange(run.started, start, end)) continue;
        const stepKey = STEP_TO_ROW[run.step];
        const row = stepKey ? byStep.get(stepKey) : undefined;
        if (!row) continue;
        const model = usageModel(run.model);
        if (model !== null) row.counts[model] += 1;
        row.totalMs = (row.totalMs ?? 0) + run.durationMs;
      }
    }

    const spans = workSpans(data, now);
    for (const span of spans) {
      if (!inRange(span.mergedAt, start, end) || span.leadMs === null) continue;
      const together = spans.some((other) => other.issue !== span.issue && overlaps(span, other));
      (together ? parallel : serial).push(span.leadMs);
    }
  }
  parallel.sort((a, b) => a - b);
  serial.sort((a, b) => a - b);
  return { rows, limitHits: null, parallelMs: median(parallel), serialMs: median(serial) };
}

/** 全部の期間の AI usage（画面に渡す小さな値。切り替えのたびに取り直さない） */
export function aiUsageAll(results: readonly RepoResult[], now: Date): Record<PeriodKey, AiUsage> {
  return Object.fromEntries(PERIOD_KEYS.map((key) => [key, aiUsage(results, now, key)])) as Record<PeriodKey, AiUsage>;
}

/** 横棒の長さ（0〜1）。2つの中央値の比で、長い方を1とする。値が無ければ null（棒なし） */
export function barRatios(parallelMs: number | null, serialMs: number | null): { parallel: number | null; serial: number | null } {
  const max = Math.max(parallelMs ?? 0, serialMs ?? 0);
  const ratio = (value: number | null) => (value === null || max <= 0 ? null : value / max);
  return { parallel: ratio(parallelMs), serial: ratio(serialMs) };
}
