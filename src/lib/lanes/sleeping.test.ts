import { describe, expect, it } from "vitest";
import {
  ACTIONS_JOB_LIMIT,
  countInProgressJobs,
  isLongSleep,
  isSleepingRun,
  jobGauge,
  sleepingCountText,
  sortByWake,
  wakeAtFromTitle,
  wakeTimeText,
} from "./sleeping";

// 日本時間 2026-11-19 14:00
const NOW = new Date("2026-11-19T05:00:00Z");
const MIN = 60_000;

describe("isSleepingRun", () => {
  it("名前が Retry Timer、または題名が目覚ましの物だけ", () => {
    expect(isSleepingRun({ name: "Retry Timer", displayTitle: "" })).toBe(true);
    expect(isSleepingRun({ displayTitle: "やり直しの目覚まし 1795068487" })).toBe(true);
    expect(isSleepingRun({ name: "Watchdog", displayTitle: "見張り" })).toBe(false);
    expect(isSleepingRun({ name: "CI", displayTitle: "やり直しの目覚ましを直す" })).toBe(false);
  });
});

describe("wakeAtFromTitle", () => {
  it("題名の unix 時刻（秒）をミリ秒にする", () => {
    expect(wakeAtFromTitle("やり直しの目覚まし 1795068487")).toBe(1_795_068_487_000);
  });

  it("読めなければ null", () => {
    expect(wakeAtFromTitle("やり直しの目覚まし ")).toBeNull();
    expect(wakeAtFromTitle("やり直しの目覚まし abc")).toBeNull();
    expect(wakeAtFromTitle("やり直しの目覚まし 12 34")).toBeNull();
    expect(wakeAtFromTitle("見張り 1795068487")).toBeNull();
  });
});

describe("sortByWake", () => {
  it("起きる時刻の早い順。読めない物は最後。元の配列は変えない", () => {
    const runs = [
      { key: "c", wakeAtMs: null },
      { key: "b", wakeAtMs: 3000 },
      { key: "a", wakeAtMs: 1000 },
      { key: "d", wakeAtMs: 3000 },
    ];
    expect(sortByWake(runs).map((run) => run.key)).toEqual(["a", "b", "d", "c"]);
    expect(runs[0].key).toBe("c");
  });
});

describe("wakeTimeText", () => {
  it("今日（日本時間）なら時刻だけ", () => {
    expect(wakeTimeText(Date.parse("2026-11-19T05:41:00Z"), NOW)).toBe("14:41");
    // 日本時間の 23:59 も今日
    expect(wakeTimeText(Date.parse("2026-11-19T14:59:00Z"), NOW)).toBe("23:59");
  });

  it("今日でなければ月/日を付ける（日の境目は日本時間）", () => {
    expect(wakeTimeText(Date.parse("2026-11-19T15:05:00Z"), NOW)).toBe("11/20 00:05");
    expect(wakeTimeText(Date.parse("2026-11-18T14:00:00Z"), NOW)).toBe("11/18 23:00");
  });
});

describe("isLongSleep", () => {
  it("今より45分より先なら Long", () => {
    expect(isLongSleep(NOW.getTime() + 46 * MIN, NOW)).toBe(true);
    expect(isLongSleep(NOW.getTime() + 45 * MIN, NOW)).toBe(false);
    expect(isLongSleep(NOW.getTime() - MIN, NOW)).toBe(false);
    expect(isLongSleep(null, NOW)).toBe(false);
  });
});

describe("countInProgressJobs", () => {
  it("in_progress のジョブを数える", () => {
    const raw = { jobs: [{ status: "in_progress" }, { status: "queued" }, { status: "completed" }, { status: "in_progress" }] };
    expect(countInProgressJobs(raw)).toBe(2);
    expect(countInProgressJobs({ jobs: [] })).toBe(0);
  });

  it("返事が読めなければ null", () => {
    expect(countInProgressJobs(null)).toBeNull();
    expect(countInProgressJobs({})).toBeNull();
  });
});

describe("jobGauge", () => {
  it("動いている実行はジョブの数、寝ている実行は1つずつ。読めなかった実行は数えない", () => {
    const gauge = jobGauge([
      { sleeping: false, jobs: 2 },
      { sleeping: false, jobs: null },
      ...Array.from({ length: 10 }, () => ({ sleeping: true, jobs: null })),
    ]);
    expect(gauge).toMatchObject({ active: 2, sleeping: 10, total: 12, limit: ACTIONS_JOB_LIMIT, text: "12/20" });
    expect(gauge.label).toBe("Actions jobs 20のうち 動いている2・寝ている10");
    expect(gauge.cells).toHaveLength(20);
    expect(gauge.cells.filter((cell) => cell === "active")).toHaveLength(2);
    expect(gauge.cells.filter((cell) => cell === "sleeping")).toHaveLength(10);
    expect(gauge.cells.slice(0, 3)).toEqual(["active", "active", "sleeping"]);
    expect(gauge.cells.at(-1)).toBe("free");
  });

  it("20を超えても数はそのまま、マスは20で打ち切り", () => {
    const gauge = jobGauge([{ sleeping: false, jobs: 15 }, ...Array.from({ length: 7 }, () => ({ sleeping: true, jobs: null }))]);
    expect(gauge.text).toBe("22/20");
    expect(gauge.cells).toHaveLength(20);
    expect(gauge.cells.filter((cell) => cell === "active")).toHaveLength(15);
    expect(gauge.cells.filter((cell) => cell === "sleeping")).toHaveLength(5);
  });
});

describe("sleepingCountText", () => {
  it("Long があれば `10 · Long 8`、0なら数だけ", () => {
    const far = { wakeAtMs: NOW.getTime() + 2 * 60 * MIN };
    const near = { wakeAtMs: NOW.getTime() + 10 * MIN };
    expect(sleepingCountText([far, far, near], NOW)).toBe("3 · Long 2");
    expect(sleepingCountText([near], NOW)).toBe("1");
  });
});
