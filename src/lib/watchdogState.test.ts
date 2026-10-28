import { describe, expect, it } from "vitest";
import { buildWatchdogNotices, judgeWatchdog } from "./watchdogState";

const NOW = new Date("2026-10-28T12:00:00Z");
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const ago = (ms: number) => ({ at: new Date(NOW.getTime() - ms).toISOString() });

describe("judgeWatchdog", () => {
  it("3時間未満は注意なし", () => {
    expect(judgeWatchdog(ago(3 * HOUR - 1000), NOW)).toEqual({ stalled: false });
    expect(judgeWatchdog(ago(0), NOW)).toEqual({ stalled: false });
  });
  it("ちょうど3時間は止まっている", () => {
    expect(judgeWatchdog(ago(3 * HOUR), NOW)).toEqual({ stalled: true, hours: 3 });
  });
  it("経過時間は時間単位で切り捨てる", () => {
    expect(judgeWatchdog(ago(3 * HOUR + 10 * MIN), NOW)).toEqual({ stalled: true, hours: 3 });
    expect(judgeWatchdog(ago(5 * HOUR + 59 * MIN), NOW)).toEqual({ stalled: true, hours: 5 });
    expect(judgeWatchdog(ago(50 * HOUR), NOW)).toEqual({ stalled: true, hours: 50 });
  });
  it("「無い」「分からない」「未取得」では出ない", () => {
    expect(judgeWatchdog("none", NOW)).toEqual({ stalled: false });
    expect(judgeWatchdog("unknown", NOW)).toEqual({ stalled: false });
    expect(judgeWatchdog(undefined, NOW)).toEqual({ stalled: false });
  });
  it("未来や読めない時刻では出ない", () => {
    expect(judgeWatchdog(ago(-HOUR), NOW)).toEqual({ stalled: false });
    expect(judgeWatchdog({ at: "xxx" }, NOW)).toEqual({ stalled: false });
  });
});

describe("buildWatchdogNotices", () => {
  it("止まっているリポジトリだけ、順に返す", () => {
    const notices = buildWatchdogNotices(
      [
        { owner: "o", repo: "a", ok: true, data: { watchdog: ago(4 * HOUR) } },
        { owner: "o", repo: "b", ok: true, data: { watchdog: ago(HOUR) } },
        { owner: "o", repo: "c", ok: false },
        { owner: "o", repo: "d", ok: true, data: { watchdog: "none" } },
        { owner: "o", repo: "e", ok: true, data: { watchdog: ago(7 * HOUR) } },
      ],
      NOW,
    );
    expect(notices).toEqual([
      { owner: "o", repo: "a", hours: 4 },
      { owner: "o", repo: "e", hours: 7 },
    ]);
  });
});
