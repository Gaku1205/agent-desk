import { describe, expect, it } from "vitest";
import { PARALLEL_MESSAGES } from "./parallel";
import {
  changeNightEnd,
  changeNightStart,
  daySpans,
  describeParallelNow,
  endSelectValue,
  nightSpans,
  nowPosition,
  parseHourOption,
  pickCountSpan,
  spanCenter,
  startSelectValue,
} from "./parallelBand";

describe("nightSpans / daySpans", () => {
  it("同じ日の中の夜", () => {
    expect(nightSpans({ start: 1, end: 8 })).toEqual([{ start: 1, end: 8 }]);
    expect(daySpans({ start: 1, end: 8 })).toEqual([{ start: 0, end: 1 }, { start: 8, end: 24 }]);
  });

  it("日またぎは左右の2つ", () => {
    expect(nightSpans({ start: 23, end: 7 })).toEqual([{ start: 0, end: 7 }, { start: 23, end: 24 }]);
    expect(daySpans({ start: 23, end: 7 })).toEqual([{ start: 7, end: 23 }]);
  });

  it("終わりが0なら右の1つだけ", () => {
    expect(nightSpans({ start: 22, end: 0 })).toEqual([{ start: 22, end: 24 }]);
  });

  it("夜が無ければ夜は空、昼は全部", () => {
    expect(nightSpans(null)).toEqual([]);
    expect(daySpans(null)).toEqual([{ start: 0, end: 24 }]);
  });
});

describe("pickCountSpan / spanCenter", () => {
  it("長い方を選ぶ", () => {
    expect(pickCountSpan(nightSpans({ start: 23, end: 7 }))).toEqual({ start: 0, end: 7 });
  });

  it("同じ長さなら先の区間", () => {
    expect(pickCountSpan(nightSpans({ start: 20, end: 4 }))).toEqual({ start: 0, end: 4 });
    expect(pickCountSpan(nightSpans({ start: 12, end: 12 }))).toBeNull();
  });

  it("区間が無ければ null", () => {
    expect(pickCountSpan([])).toBeNull();
  });

  it("真ん中", () => {
    expect(spanCenter({ start: 8, end: 24 })).toBeCloseTo(16 / 24);
  });
});

describe("選択欄の値", () => {
  it("nightHours から値へ", () => {
    expect(startSelectValue({ start: 23, end: 7 })).toBe("23:00");
    expect(endSelectValue({ start: 23, end: 7 })).toBe("7:00");
    expect(startSelectValue(null)).toBe("Off");
    expect(endSelectValue(null)).toBe("");
  });

  it("値から時刻へ", () => {
    expect(parseHourOption("0:00")).toBe(0);
    expect(parseHourOption("23:00")).toBe(23);
    expect(parseHourOption("24:00")).toBeNull();
    expect(parseHourOption("Off")).toBeNull();
  });

  it("始まりを変える", () => {
    expect(changeNightStart({ start: 23, end: 7 }, "22:00")).toEqual({ kind: "set", hours: { start: 22, end: 7 } });
    expect(changeNightStart({ start: 23, end: 7 }, "Off")).toEqual({ kind: "set", hours: null });
    expect(changeNightStart(null, "22:00")).toEqual({ kind: "set", hours: { start: 22, end: 6 } });
    expect(changeNightStart({ start: 23, end: 7 }, "7:00")).toEqual({ kind: "error", message: PARALLEL_MESSAGES.sameHours });
  });

  it("終わりを変える", () => {
    expect(changeNightEnd({ start: 23, end: 7 }, "6:00")).toEqual({ kind: "set", hours: { start: 23, end: 6 } });
    expect(changeNightEnd({ start: 23, end: 7 }, "23:00")).toEqual({ kind: "error", message: PARALLEL_MESSAGES.sameHours });
  });
});

describe("今", () => {
  // 日本時間 10:39
  const now = new Date("2026-11-19T01:39:00Z");

  it("縦線の位置は時＋分", () => {
    expect(nowPosition(now)).toBeCloseTo((10 * 60 + 39) / 1440);
  });

  it("昼", () => {
    expect(describeParallelNow(now, { start: 23, end: 7 })).toEqual({ time: "10:39", period: "Day" });
  });

  it("夜", () => {
    expect(describeParallelNow(new Date("2026-11-17T17:05:00Z"), { start: 23, end: 7 })).toEqual({
      time: "2:05",
      period: "Night",
    });
  });

  it("夜が無ければ昼", () => {
    expect(describeParallelNow(new Date("2026-11-17T17:05:00Z"), null).period).toBe("Day");
  });
});
