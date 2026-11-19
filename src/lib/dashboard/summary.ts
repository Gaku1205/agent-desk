/** Dashboard のまとめ：期間内のマージ数・リードタイム・止まった回数・AIが動いた時間（入力は `loadTurns` の `results` だけ） */

import type { RepoData, RepoResult } from "../github/types";
import { isLinkedPull, isSyncPull } from "../status";
import { isStepLogComment, STEP_LOG_MARKER } from "../stepLog";
import { inRange, PERIOD_KEYS, periodRange, type PeriodKey } from "./period";

export type Summary = {
  /** 期間内にマージされたPRの数。読めたリポジトリが1つも無ければ null（`—`） */
  merged: number | null;
  /** その前の同じ長さの期間のマージ数 */
  mergedPrev: number | null;
  /** 期間内にマージされた配布のPR（`pipeline-sync/`）で、`Merged` から外した数。`prev` の分は出さない */
  mergedSyncExcluded: number | null;
  /** Issue の作成 → PR のマージ（ミリ秒）の中央値と p90。数える物が無ければ null */
  leadMedianMs: number | null;
  leadP90Ms: number | null;
  /** 期間内に `ai:stuck` が付いた回数 */
  stopped: number | null;
  /** 人間が直した回数。今のデータからは確かに分からないので常に null（`—`） */
  fixedByHuman: null;
  /** 期間内に始まった進捗ログの行の所要時間の合計（ミリ秒） */
  aiTimeMs: number | null;
  /** その行数 */
  runs: number | null;
  /** 回数制限に当たった回数。今のデータからは分からないので常に null（`—`） */
  limitHits: null;
};

/** 小さい順に並べた値の中央値（偶数個なら真ん中2つの平均）。空なら null */
export function median(sorted: readonly number[]): number | null {
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** 小さい順に並べた値の p90（最近傍順位法：ceil(0.9 × 個数) 番目）。空なら null */
export function p90(sorted: readonly number[]): number | null {
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.9) - 1)];
}

export function time(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

/** マージされた配布のPR（`pipeline-sync/`）のマージ時刻。`Merged` から外した分を数えるための物 */
export function mergedSyncTimes(data: RepoData): number[] {
  const times: number[] = [];
  for (const pull of data.pulls) {
    if (!pull.merged || !isSyncPull(pull)) continue;
    const mergedAt = time(pull.mergedAt);
    if (mergedAt !== null) times.push(mergedAt);
  }
  return times;
}

/** マージされたPR（配布のPRは除く）と、紐づくIssueの作成時刻（紐づくIssueが無ければ null）の組 */
export function mergedPulls(data: RepoData): { mergedAt: number; createdAt: number | null }[] {
  const rows: { mergedAt: number; createdAt: number | null }[] = [];
  for (const pull of data.pulls) {
    if (!pull.merged || isSyncPull(pull)) continue;
    const mergedAt = time(pull.mergedAt);
    if (mergedAt === null) continue;
    const issue = data.issues.find((candidate) => isLinkedPull(pull, candidate.number));
    rows.push({ mergedAt, createdAt: issue ? time(issue.createdAt) : null });
  }
  return rows;
}

/** 進捗ログの1行ぶん（始まった時刻と所要時間）。壊れた行は読み飛ばす */
export type RunRow = {
  /** 進捗ログの `step`（`mocks` など。知らない名前もそのまま） */
  step: string;
  /** 使ったモデル（`sonnet` など）。記録が無い・空なら null */
  model: string | null;
  started: number;
  durationMs: number;
};

export function parseRunRows(body: string, now: Date): RunRow[] {
  const rows: RunRow[] = [];
  for (const line of body.split(/\r?\n/)) {
    const match = /^\s*<!--\s*ai-step\s+(\{.*\})\s*-->\s*$/.exec(line);
    if (!match) continue;
    let data: unknown;
    try {
      data = JSON.parse(match[1]);
    } catch {
      continue;
    }
    if (typeof data !== "object" || data === null || Array.isArray(data)) continue;
    const row = data as Record<string, unknown>;
    if (typeof row.step !== "string") continue;
    const started = typeof row.started === "string" ? time(row.started) : null;
    if (started === null || !("finished" in row)) continue;
    const end = row.finished === null ? now.getTime() : typeof row.finished === "string" ? time(row.finished) : null;
    if (end === null || end < started) continue;
    const model = typeof row.model === "string" && row.model.trim() !== "" ? row.model.trim().toLowerCase() : null;
    rows.push({ step: row.step, model, started, durationMs: end - started });
  }
  return rows;
}

/** 1つの期間のまとめ。読めたリポジトリ（`ok`）だけを数える */
export function summarize(results: readonly RepoResult[], now: Date, key: PeriodKey): Summary {
  const { start, end, prevStart } = periodRange(now, key);
  const loaded = results.flatMap((result) => (result.ok ? [result.data] : []));
  if (loaded.length === 0) {
    return {
      merged: null,
      mergedPrev: null,
      mergedSyncExcluded: null,
      leadMedianMs: null,
      leadP90Ms: null,
      stopped: null,
      fixedByHuman: null,
      aiTimeMs: null,
      runs: null,
      limitHits: null,
    };
  }

  let merged = 0;
  let mergedPrev = 0;
  let mergedSyncExcluded = 0;
  let stopped = 0;
  let aiTimeMs = 0;
  let runs = 0;
  const leads: number[] = [];
  for (const data of loaded) {
    for (const row of mergedPulls(data)) {
      if (inRange(row.mergedAt, start, end)) {
        merged += 1;
        if (row.createdAt !== null && row.mergedAt >= row.createdAt) leads.push(row.mergedAt - row.createdAt);
      } else if (inRange(row.mergedAt, prevStart, start)) {
        mergedPrev += 1;
      }
    }
    for (const at of mergedSyncTimes(data)) {
      if (inRange(at, start, end)) mergedSyncExcluded += 1;
    }
    for (const event of data.events) {
      const at = time(event.createdAt);
      if (event.event === "labeled" && event.labelName === "ai:stuck" && at !== null && inRange(at, start, end)) {
        stopped += 1;
      }
    }
    for (const comment of data.comments) {
      if (!comment.body.includes(STEP_LOG_MARKER) || !isStepLogComment(comment.body)) continue;
      for (const row of parseRunRows(comment.body, now)) {
        if (!inRange(row.started, start, end)) continue;
        runs += 1;
        aiTimeMs += row.durationMs;
      }
    }
  }
  leads.sort((a, b) => a - b);
  return {
    merged,
    mergedPrev,
    mergedSyncExcluded,
    leadMedianMs: median(leads),
    leadP90Ms: p90(leads),
    stopped,
    fixedByHuman: null,
    aiTimeMs,
    runs,
    limitHits: null,
  };
}

/** 全部の期間のまとめ（画面に渡す小さな値。切り替えのたびに取り直さない） */
export function summarizeAll(results: readonly RepoResult[], now: Date): Record<PeriodKey, Summary> {
  return Object.fromEntries(PERIOD_KEYS.map((key) => [key, summarize(results, now, key)])) as Record<PeriodKey, Summary>;
}

/** まとめの文：`この24時間：14件マージ、止まり 3回` 数が取れないときは `—` */
export function summarySentence(summary: Summary, wordOfPeriod: string): string {
  const merged = summary.merged === null ? "—" : String(summary.merged);
  const stopped = summary.stopped === null ? "—" : String(summary.stopped);
  return `この${wordOfPeriod}：${merged}件マージ、止まり ${stopped}回`;
}
