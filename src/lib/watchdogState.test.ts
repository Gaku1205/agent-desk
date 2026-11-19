import { describe, expect, it } from "vitest";
import { buildWatchdogNotices, hasActiveWork, judgeWatchdog } from "./watchdogState";

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

const busyIssues = [{ state: "open" as const, labels: ["ai:implement"] }];
const busyPulls = [{ state: "open" as const, headRef: "claude/issue-1-x" }];

describe("hasActiveWork", () => {
  it("作業のラベルが付いた開いた Issue があれば true", () => {
    for (const label of ["ai:plan", "ai:implement", "ai:review", "ai:queue", "ai:retry"]) {
      expect(hasActiveWork([{ state: "open", labels: [label] }], [])).toBe(true);
    }
  });
  it("claude/ の開いた PR があれば true", () => {
    expect(hasActiveWork([], busyPulls)).toBe(true);
  });
  it("何も無い・関係ないラベル・閉じた物・claude/ 以外は false", () => {
    expect(hasActiveWork([], [])).toBe(false);
    expect(hasActiveWork([{ state: "open", labels: ["bug", "ai:hold"] }], [])).toBe(false);
    expect(hasActiveWork([{ state: "closed", labels: ["ai:implement"] }], [])).toBe(false);
    expect(hasActiveWork([], [{ state: "closed", headRef: "claude/issue-1-x" }])).toBe(false);
    expect(hasActiveWork([], [{ state: "open", headRef: "feature/x" }])).toBe(false);
  });
});

describe("buildWatchdogNotices", () => {
  it("作業があって止まっているリポジトリだけ、順に返す", () => {
    const notices = buildWatchdogNotices(
      [
        { owner: "o", repo: "a", ok: true, data: { watchdog: ago(4 * HOUR), issues: busyIssues, pulls: [] } },
        { owner: "o", repo: "b", ok: true, data: { watchdog: ago(HOUR), issues: busyIssues, pulls: [] } },
        { owner: "o", repo: "c", ok: false },
        { owner: "o", repo: "d", ok: true, data: { watchdog: "none", issues: busyIssues, pulls: [] } },
        { owner: "o", repo: "e", ok: true, data: { watchdog: ago(7 * HOUR), issues: [], pulls: busyPulls } },
      ],
      NOW,
    );
    expect(notices).toEqual([
      { owner: "o", repo: "a", hours: 4 },
      { owner: "o", repo: "e", hours: 7 },
    ]);
  });
  it("作業が無ければ、何時間止まっていても出さない", () => {
    const notices = buildWatchdogNotices(
      [{ owner: "o", repo: "quiet", ok: true, data: { watchdog: ago(50 * HOUR), issues: [], pulls: [] } }],
      NOW,
    );
    expect(notices).toEqual([]);
  });
  it("作業ありでも、止まった時間が3時間未満なら出さない", () => {
    const notices = buildWatchdogNotices(
      [{ owner: "o", repo: "busy", ok: true, data: { watchdog: ago(3 * HOUR - 1000), issues: busyIssues, pulls: busyPulls } }],
      NOW,
    );
    expect(notices).toEqual([]);
  });
});
