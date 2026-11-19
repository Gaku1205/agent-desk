/** Dashboard の Stops：止まった理由の内訳と、最近止まった物（入力は `loadTurns` の `results` と期間だけ） */

import { failureReasonText, parseFailureReason } from "../failureReason";
import type { CommentData, RepoData, RepoResult } from "../github/types";
import { AUTO_FIX_MARK, findLinkedPull, isLinkedPull, RETRY_COUNT_PATTERN, RETRY_MARK, stuckReasonFor } from "../status";
import { inRange, PERIOD_KEYS, periodRange, time, type PeriodKey } from "./period";

/** 止まった理由の分類（画面に出す順） */
export const STOP_REASONS = ["ci", "permission", "queue", "human"] as const;
export type StopReason = (typeof STOP_REASONS)[number];

/** 理由の文の言葉 → 分類。上から順に当てる（どれにも当たらなければ人間の確認待ち）。言葉はここ1か所 */
export const STOP_WORDS: { kind: Exclude<StopReason, "human">; words: readonly string[] }[] = [
  { kind: "ci", words: ["ci", "テスト", "ビルド", "チェック", "lint", "typecheck"] },
  { kind: "permission", words: ["許可", "権限", "permission"] },
  { kind: "queue", words: ["順番待ち"] },
];

/** 最近止まった物に出す件数 */
export const RECENT_LIMIT = 8;

/** 理由の文の探しに使う、止まった時刻からの余裕（理由のコメントはラベルの少し前後に書かれる） */
const REASON_GRACE_MS = 10 * 60 * 1000;

/** 理由の文 → 分類。文が取れなければ人間の確認待ち */
export function classifyStop(reason: string | null): StopReason {
  if (reason === null) return "human";
  const lower = reason.toLowerCase();
  for (const { kind, words } of STOP_WORDS) {
    if (words.some((word) => (word === "ci" ? /(^|[^a-z])ci([^a-z]|$)/.test(lower) : lower.includes(word)))) return kind;
  }
  return "human";
}

export type StopItem = {
  /** `repo`（`owner/` を省いた名前） */
  repo: string;
  /** 止まった作業の Issue の番号（PR が止まったときも、紐づく Issue の番号。紐づく Issue が無ければ PR の番号） */
  number: number;
  /** 紐づく PR の番号（無ければ null）。行に小さく `PR #604` と出す */
  pull: number | null;
  /** 同じ作業が同じ分類で続いた止まりをまとめた回数（1なら出さない） */
  times: number;
  /** 理由の文（最新の止まりの。取れなければ null） */
  reason: string | null;
  kind: StopReason;
  /** 止まっていた時間（まとめた分の合計。止まり中は「今」まで） */
  durationMs: number;
  /** 最新の止まりが、まだ止まっている */
  ongoing: boolean;
  /** 最新の止まりは `ai:stuck` が外れた */
  fixed: boolean;
  /** 最新の止まりの時刻（並べ替え用） */
  startedAt: number;
};

export type Stops = {
  /** 理由ごとの回数。読めたリポジトリが無ければ null（`—`） */
  counts: Record<StopReason, number> | null;
  /** CIの失敗の回数（CIの止まり＋自動の修正依頼）。取れなければ null */
  ciFailures: number | null;
  /** そのうち自動で直った回数（修正依頼のあとにそのPRがマージされた物）。取れなければ null */
  autoFixed: number | null;
  /** 自動のやり直しの回数。取れなければ null */
  retries: number | null;
  /** 新しい順に最大8件 */
  recent: StopItem[];
};

function emptyStops(): Stops {
  return { counts: null, ciFailures: null, autoFixed: null, retries: null, recent: [] };
}

/** その番号が指すIssueと紐づくPRの番号（番号がPRならそのPRと、紐づくIssue） */
function resolveNumbers(data: RepoData, number: number): { issue: number; pull: number | null } {
  const pull = data.pulls.find((candidate) => candidate.number === number);
  if (pull) {
    const issue = data.issues.find((candidate) => isLinkedPull(pull, candidate.number));
    return { issue: issue?.number ?? number, pull: pull.number };
  }
  return { issue: number, pull: findLinkedPull(data.pulls, number)?.number ?? null };
}

/** `ai:stuck` の付け外しを、番号ごとに時刻順に組にする */
function stuckSpans(data: RepoData, now: number): { number: number; from: number; to: number | null; ongoing: boolean }[] {
  const events = data.events
    .flatMap((event) => {
      const at = time(event.createdAt);
      const isStuck = event.labelName === "ai:stuck" && (event.event === "labeled" || event.event === "unlabeled");
      return isStuck && at !== null && event.issueNumber !== null
        ? [{ number: event.issueNumber, labeled: event.event === "labeled", at }]
        : [];
    })
    .sort((a, b) => a.at - b.at);
  const open = new Map<number, number>();
  const spans: { number: number; from: number; to: number | null; ongoing: boolean }[] = [];
  for (const event of events) {
    if (event.labeled) {
      if (!open.has(event.number)) open.set(event.number, event.at);
      continue;
    }
    const from = open.get(event.number);
    if (from === undefined) continue;
    open.delete(event.number);
    spans.push({ number: event.number, from, to: event.at, ongoing: false });
  }
  for (const [number, from] of open) spans.push({ number, from, to: null, ongoing: true });
  return spans.map((span) => ({ ...span, to: span.to ?? now }));
}

/** 止まり1回分（まとめる前）。Issue の番号にそろえてある */
export type RawStop = {
  issue: number;
  pull: number | null;
  reason: string | null;
  kind: StopReason;
  from: number;
  to: number;
  ongoing: boolean;
};

/**
 * 同じリポジトリ・同じ Issue・同じ分類の止まりを1つにまとめる。
 * 時間が重なる止まり（Issue と PR が同時に止まった）は1回、離れていれば別の回（外れて、また付いた）。
 * 時間は重ならない分の合計、理由・状態・時刻は最新の止まりの物
 */
export function mergeStops(repo: string, raws: readonly RawStop[]): StopItem[] {
  const groups = new Map<string, RawStop[]>();
  for (const raw of raws) {
    const key = `${raw.issue}:${raw.kind}`;
    groups.set(key, [...(groups.get(key) ?? []), raw]);
  }
  const items: StopItem[] = [];
  for (const group of groups.values()) {
    const sorted = [...group].sort((a, b) => a.from - b.from);
    const runs: { from: number; to: number; ongoing: boolean; reason: string | null; pull: number | null }[] = [];
    for (const raw of sorted) {
      const last = runs.at(-1);
      if (last && raw.from <= last.to) {
        last.to = Math.max(last.to, raw.to);
        last.ongoing = last.ongoing || raw.ongoing;
        last.pull = raw.pull ?? last.pull;
        if (last.reason === null) last.reason = raw.reason;
      } else {
        runs.push({ from: raw.from, to: raw.to, ongoing: raw.ongoing, reason: raw.reason, pull: raw.pull });
      }
    }
    const latest = runs[runs.length - 1];
    const pull = [...runs].reverse().find((run) => run.pull !== null)?.pull ?? null;
    items.push({
      repo,
      number: sorted[0].issue,
      pull,
      times: runs.length,
      reason: latest.reason,
      kind: sorted[0].kind,
      durationMs: runs.reduce((sum, run) => sum + Math.max(0, run.to - run.from), 0),
      ongoing: latest.ongoing,
      fixed: !latest.ongoing,
      startedAt: latest.from,
    });
  }
  return items;
}

function stuckItems(result: Extract<RepoResult, { ok: true }>, now: number, start: number, end: number): StopItem[] {
  const data = result.data;
  const raws: RawStop[] = [];
  for (const span of stuckSpans(data, now)) {
    if (!inRange(span.from, start, end)) continue;
    const { issue, pull } = resolveNumbers(data, span.number);
    const before: CommentData[] = data.comments.filter((comment) => {
      const at = time(comment.createdAt);
      return at !== null && at <= span.from + REASON_GRACE_MS;
    });
    const raw = stuckReasonFor(before, issue, pull);
    const reason = raw === null ? null : failureReasonText(parseFailureReason(raw, `${result.owner}/${result.repo}`));
    raws.push({
      issue,
      pull: pull === issue ? null : pull,
      reason,
      kind: classifyStop(reason),
      from: span.from,
      to: span.to ?? now,
      ongoing: span.ongoing,
    });
  }
  return mergeStops(result.repo, raws);
}

/** 1つの期間の Stops。読めたリポジトリ（`ok`）だけを数える */
export function stops(results: readonly RepoResult[], now: Date, key: PeriodKey): Stops {
  const { start, end } = periodRange(now, key);
  const counts: Record<StopReason, number> = { ci: 0, permission: 0, queue: 0, human: 0 };
  const items: StopItem[] = [];
  let loadedCount = 0;
  let fixRequests = 0;
  let autoFixed = 0;
  let retries = 0;

  for (const result of results) {
    if (!result.ok) continue;
    loadedCount += 1;
    for (const item of stuckItems(result, now.getTime(), start, end)) {
      counts[item.kind] += 1;
      items.push(item);
    }
    for (const comment of result.data.comments) {
      const at = time(comment.createdAt);
      if (at === null || !inRange(at, start, end)) continue;
      if (comment.body.includes(AUTO_FIX_MARK)) {
        fixRequests += 1;
        const mergedAt = time(result.data.pulls.find((pull) => pull.number === comment.issueNumber && pull.merged)?.mergedAt ?? null);
        if (mergedAt !== null && mergedAt > at) autoFixed += 1;
      } else if (comment.body.includes(RETRY_MARK) && RETRY_COUNT_PATTERN.test(comment.body)) {
        retries += 1;
      }
    }
  }

  if (loadedCount === 0) return emptyStops();
  items.sort((a, b) => b.startedAt - a.startedAt);
  return {
    counts,
    ciFailures: counts.ci + fixRequests,
    autoFixed,
    retries,
    recent: items.slice(0, RECENT_LIMIT),
  };
}

/** 横棒の長さ（いちばん多い理由を1とした割合）。0回は 0、全部 0 なら全部 0 */
export function reasonRatios(counts: Record<StopReason, number>): Record<StopReason, number> {
  const max = Math.max(...STOP_REASONS.map((kind) => counts[kind]));
  return Object.fromEntries(STOP_REASONS.map((kind) => [kind, max === 0 ? 0 : counts[kind] / max])) as Record<StopReason, number>;
}

/** 全部の期間の Stops（画面に渡す小さな値。切り替えのたびに取り直さない） */
export function stopsAll(results: readonly RepoResult[], now: Date): Record<PeriodKey, Stops> {
  return Object.fromEntries(PERIOD_KEYS.map((key) => [key, stops(results, now, key)])) as Record<PeriodKey, Stops>;
}
