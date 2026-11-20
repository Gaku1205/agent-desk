import { createHash } from "node:crypto";
import type { WatchedRepo } from "../config";
import type { Fetcher } from "./client";
import { listUsageIssues } from "./usageIssue";

// Dashboard の Services の Vercel の CPU の行（docs/spec.md の「Dashboard」の「Services」）。サーバーだけで使う。
// `SETTINGS_REPO` の `使用量：YYYY-MM-DD` の Issue を読んで、日付キー → 合計 ms にする。5分覚える（失敗は覚えない）。

export const CPU_MEMO_TTL_MS = 5 * 60 * 1000;
const CPU_MEMO_MAX = 20;

const memo = new Map<string, { value: Map<string, number>; savedAt: number }>();

/** テスト用：覚えた物を空にする */
export function clearCpuMemoForTest(): void {
  memo.clear();
}

/**
 * 日ごとの CPU 時間（日付キー → ms）。`SETTINGS_REPO` が無い・読めなければ null。
 * `knownOnly` のときは GitHub を読まず、覚えている物だけ返す
 */
export async function loadCpuTotals(input: {
  token: string;
  settingsRepo: WatchedRepo | null;
  nowMs: number;
  knownOnly?: boolean;
  fetcher?: Fetcher;
}): Promise<Map<string, number> | null> {
  const { token, settingsRepo, nowMs } = input;
  if (!token || !settingsRepo) return null;
  const key = `${createHash("sha256").update(token).digest("hex")}:${settingsRepo.owner}/${settingsRepo.repo}`.toLowerCase();
  const entry = memo.get(key);
  if (entry && nowMs - entry.savedAt < CPU_MEMO_TTL_MS && nowMs >= entry.savedAt) return entry.value;
  if (input.knownOnly) return null;
  const issues = await listUsageIssues(token, settingsRepo, input.fetcher ?? fetch);
  if (issues === null) return null;
  const totals = new Map([...issues].map(([date, { totalMs }]) => [date, totalMs]));
  memo.delete(key);
  while (memo.size >= CPU_MEMO_MAX) {
    const oldest = memo.keys().next();
    if (oldest.done) break;
    memo.delete(oldest.value);
  }
  memo.set(key, { value: totals, savedAt: nowMs });
  return totals;
}
