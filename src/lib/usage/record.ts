import {
  budgetOf,
  buildUsageReport,
  cpuDeltaMs,
  formatUsageBody,
  jstDateKey,
  usageTitle,
  type BudgetState,
  type CpuUsageMicros,
  type UsageReport,
} from "./cpuBudget";
import type { UsageIssues } from "../github/usageIssue";

/** 1つのインスタンスで、続けて書く間隔の下限（これ未満なら書かず、増え分は次に持ち越す） */
export const MIN_WRITE_INTERVAL_MS = 10 * 60 * 1000;

/** 使用量の Issue を読み書きする窓口（GitHub への呼び出しはここから差し替える） */
export type UsageStore = {
  list: () => Promise<UsageIssues | null>;
  create: (title: string, body: string) => Promise<boolean>;
  update: (number: number, body: string) => Promise<boolean>;
};

export type UsageOutcome = { usage: UsageReport | null; budget: BudgetState };

const UNKNOWN: UsageOutcome = { usage: null, budget: "unknown" };

// インスタンスごとのメモリ。前に書いたときの cpuUsage と、書いた時刻
let lastUsage: CpuUsageMicros = { user: 0, system: 0 };
let lastWriteAt: number | null = null;

export function clearUsageStateForTest(): void {
  lastUsage = { user: 0, system: 0 };
  lastWriteAt = null;
}

/**
 * CPU 時間の増え分を今日の Issue に足し、今日の合計・直近7日の平均・割合を返す。
 * 読めない・書けないときは { usage: null, budget: "unknown" }（落とさない）。
 * 画面・API のリクエストの経路では呼ばない（`/api/selfcheck` からだけ）
 */
export async function recordCpuUsage(
  store: UsageStore,
  now: Date = new Date(),
  current: CpuUsageMicros = process.cpuUsage(),
): Promise<UsageOutcome> {
  const issues = await store.list();
  if (!issues) return UNKNOWN;

  const totals = new Map<string, number>();
  for (const [key, value] of issues) totals.set(key, value.totalMs);

  const due = lastWriteAt === null || now.getTime() - lastWriteAt >= MIN_WRITE_INTERVAL_MS;
  const delta = cpuDeltaMs(lastUsage, current);
  if (due && delta > 0) {
    const today = jstDateKey(now);
    const existing = issues.get(today);
    const total = (existing?.totalMs ?? 0) + delta;
    const body = formatUsageBody(total);
    const written = existing ? await store.update(existing.number, body) : await store.create(usageTitle(today), body);
    if (!written) return UNKNOWN;
    totals.set(today, total);
    lastUsage = current;
    lastWriteAt = now.getTime();
  }

  const usage = buildUsageReport(totals, now);
  return { usage, budget: budgetOf(usage.ratio) };
}
