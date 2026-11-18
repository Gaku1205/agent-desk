/** かかった時間の書き方（d・h・m・s）。docs/design.md の「Dashboard」 */

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * `1d 2h`・`1h 52m`・`9h 41m`・`38m`・`20s` のように短く整形する。
 * 1日以上は日と時間、1時間以上は時間と分、1分以上は分（秒は出さない）、1分未満は秒。ちょうどの端（`2h 0m`）は出さない。
 * 負・数でないときは `—`
 */
export function formatSpan(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms >= DAY) {
    const days = Math.floor(ms / DAY);
    const hours = Math.floor((ms % DAY) / HOUR);
    return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  }
  if (ms >= HOUR) {
    const hours = Math.floor(ms / HOUR);
    const minutes = Math.floor((ms % HOUR) / MINUTE);
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  if (ms >= MINUTE) return `${Math.floor(ms / MINUTE)}m`;
  return `${Math.floor(ms / SECOND)}s`;
}
