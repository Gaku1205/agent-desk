// サーバーの CPU 時間の予算（docs/spec.md の「サーバーの CPU の予算」の「使用量の数え方と知らせ方」）。
// 入力から出力が決まる純粋関数だけを置く。

/** 1日の予算（ms）。spec の「1日4分まで」 */
export const DAILY_BUDGET_MS = 4 * 60 * 1000;
/** 0.5 以上で warn */
export const WARN_RATIO = 0.5;
/** 1.0 以上で over */
export const OVER_RATIO = 1.0;
/** 直近の1日平均に使う日数（今日を含む） */
export const AVERAGE_DAYS = 7;
/** 日ごとの Issue の題名の頭 */
export const USAGE_TITLE_PREFIX = "使用量：";

export type Budget = "ok" | "warn" | "over";
export type BudgetState = Budget | "unknown";

export type CpuUsageMicros = { user: number; system: number };

/** process.cpuUsage()（マイクロ秒）の増え分を ms で返す。減っていたら（作り直し等）0 */
export function cpuDeltaMs(previous: CpuUsageMicros, current: CpuUsageMicros): number {
  const micros = current.user + current.system - (previous.user + previous.system);
  return micros > 0 ? Math.round(micros / 1000) : 0;
}

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 日本時間の日付キー（YYYY-MM-DD） */
export function jstDateKey(at: Date): string {
  return new Date(at.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);
}

/** 今日（日本時間）から遡った日付キー。今日が先頭 */
export function recentDateKeys(now: Date, days: number = AVERAGE_DAYS): string[] {
  return Array.from({ length: days }, (_, index) => jstDateKey(new Date(now.getTime() - index * 24 * 60 * 60 * 1000)));
}

export function usageTitle(dateKey: string): string {
  return `${USAGE_TITLE_PREFIX}${dateKey}`;
}

/** 題名から日付キーを取り出す。使用量の題名でなければ null */
export function dateKeyFromTitle(title: string): string | null {
  if (!title.startsWith(USAGE_TITLE_PREFIX)) return null;
  const key = title.slice(USAGE_TITLE_PREFIX.length);
  return /^\d{4}-\d{2}-\d{2}$/.test(key) ? key : null;
}

const BODY_LABEL = "CPU時間（ms）：";

/** Issue の本文（読み戻せる決まった形） */
export function formatUsageBody(totalMs: number): string {
  return `${BODY_LABEL}${Math.round(totalMs)}\n\nagent-desk のサーバーが数えた、この日（日本時間）の CPU 時間の合計です。自動で書き直されます。`;
}

/** 本文から合計 ms を読む。読めなければ null */
export function parseUsageBody(body: string | null | undefined): number | null {
  const match = body?.match(/CPU時間（ms）：(\d+)/);
  return match ? Number(match[1]) : null;
}

export function usageRatio(todayMs: number): number {
  return todayMs / DAILY_BUDGET_MS;
}

/** 割合から budget を決める。0.5・1.0 ちょうどを含む（以上） */
export function budgetOf(ratio: number): Budget {
  if (ratio >= OVER_RATIO) return "over";
  if (ratio >= WARN_RATIO) return "warn";
  return "ok";
}

/** 直近7日（今日を含む）の1日平均。Issue が無い日は 0ms として7で割る */
export function averageMs(totalsByDate: ReadonlyMap<string, number>, now: Date): number {
  const keys = recentDateKeys(now);
  const sum = keys.reduce((total, key) => total + (totalsByDate.get(key) ?? 0), 0);
  return Math.round(sum / AVERAGE_DAYS);
}

export type UsageReport = { todayMs: number; avg7Ms: number; ratio: number };

export function buildUsageReport(totalsByDate: ReadonlyMap<string, number>, now: Date): UsageReport {
  const todayMs = totalsByDate.get(jstDateKey(now)) ?? 0;
  return { todayMs, avg7Ms: averageMs(totalsByDate, now), ratio: usageRatio(todayMs) };
}
