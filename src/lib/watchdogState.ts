/** 見張り役（`watchdog.yml`）の最後の実行。「無い」＝ワークフローが無い・実行が0件、「分からない」＝取れなかった */
export type WatchdogLastRun = { at: string } | "none" | "unknown";

export type WatchdogAlert = { stalled: false } | { stalled: true; hours: number };

/** この時間以上動いていなければ「止まっている」 */
export const WATCHDOG_STALL_HOURS = 3;
const HOUR_MS = 60 * 60 * 1000;

/** 最後の実行から3時間以上たっていたら「止まっている」。経過時間は時間単位で切り捨てる（docs/spec.md） */
export function judgeWatchdog(lastRun: WatchdogLastRun | undefined, now: Date): WatchdogAlert {
  if (lastRun === undefined || lastRun === "none" || lastRun === "unknown") {
    return { stalled: false };
  }
  const elapsed = now.getTime() - Date.parse(lastRun.at);
  if (Number.isNaN(elapsed) || elapsed < WATCHDOG_STALL_HOURS * HOUR_MS) {
    return { stalled: false };
  }
  return { stalled: true, hours: Math.floor(elapsed / HOUR_MS) };
}

export type WatchdogNotice = { owner: string; repo: string; hours: number };

type WatchdogResult =
  | { owner: string; repo: string; ok: true; data: { watchdog?: WatchdogLastRun } }
  | { owner: string; repo: string; ok: false };

/** 止まっているリポジトリの注意を、取得結果の順に作る */
export function buildWatchdogNotices(
  results: ReadonlyArray<WatchdogResult>,
  now: Date,
): WatchdogNotice[] {
  const notices: WatchdogNotice[] = [];
  for (const result of results) {
    if (!result.ok) continue;
    const alert = judgeWatchdog(result.data.watchdog, now);
    if (alert.stalled) notices.push({ owner: result.owner, repo: result.repo, hours: alert.hours });
  }
  return notices;
}
