import { describe, expect, it } from "vitest";
import {
  activeParallelOverride,
  describeParallelBar,
  describeParallelButton,
  formatParallelOverride,
  nextPeriodSwitch,
  parseParallelOverride,
  planParallelToggle,
  resolveParallelState,
  type ParallelSettings,
} from "./parallel";

const settings: ParallelSettings = { day: 3, night: 1, nightHours: { start: 1, end: 8 } };
/** 日本時間 2026-11-17 15:30（昼） */
const afternoon = new Date("2026-11-17T06:30:00Z");
/** 日本時間 2026-11-18 03:20（夜） */
const lateNight = new Date("2026-11-17T18:20:00Z");

describe("parseParallelOverride", () => {
  it("night until / day until と ISO 8601 の期限を読む", () => {
    expect(parseParallelOverride("night until 2026-11-18T08:00+09:00")).toEqual({
      period: "night",
      until: new Date("2026-11-17T23:00:00Z"),
    });
    expect(parseParallelOverride("day until 2026-11-18T08:00:00Z")?.period).toBe("day");
  });

  it("形が違う・期限が読めない物は null", () => {
    expect(parseParallelOverride(null)).toBeNull();
    expect(parseParallelOverride("")).toBeNull();
    expect(parseParallelOverride("night")).toBeNull();
    expect(parseParallelOverride("evening until 2026-11-18T08:00+09:00")).toBeNull();
    expect(parseParallelOverride("night until tomorrow")).toBeNull();
    expect(parseParallelOverride("night until 2026-11-18")).toBeNull();
    expect(parseParallelOverride("night until 2026-13-45T99:00+09:00")).toBeNull();
  });
});

describe("formatParallelOverride", () => {
  it("日本時間（+09:00）の分までで書く", () => {
    expect(formatParallelOverride({ period: "night", until: new Date("2026-11-17T23:00:00Z") })).toBe(
      "night until 2026-11-18T08:00+09:00",
    );
  });

  it("読み取りと往復できる", () => {
    const override = { period: "day" as const, until: new Date("2026-11-17T16:00:00Z") };
    expect(parseParallelOverride(formatParallelOverride(override))).toEqual(override);
  });
});

describe("activeParallelOverride", () => {
  it("期限の前だけ効く", () => {
    expect(activeParallelOverride("night until 2026-11-18T08:00+09:00", afternoon)?.period).toBe("night");
    expect(activeParallelOverride("night until 2026-11-17T08:00+09:00", afternoon)).toBeNull();
  });
});

describe("nextPeriodSwitch", () => {
  it("昼に切り替えたら、次の夜の始まりまで", () => {
    expect(nextPeriodSwitch(afternoon, "day", settings.nightHours)).toEqual(new Date("2026-11-17T16:00:00Z"));
    // 夜のうちに昼へ切り替えても、次の夜の始まりまで
    expect(nextPeriodSwitch(lateNight, "day", settings.nightHours)).toEqual(new Date("2026-11-18T16:00:00Z"));
  });

  it("夜に切り替えたら、夜の終わりまで（昼のうちなら、次の夜の終わりまで）", () => {
    expect(nextPeriodSwitch(lateNight, "night", settings.nightHours)).toEqual(new Date("2026-11-17T23:00:00Z"));
    expect(nextPeriodSwitch(afternoon, "night", settings.nightHours)).toEqual(new Date("2026-11-17T23:00:00Z"));
  });

  it("日またぎの夜の時間帯でも切り替わりを見つける", () => {
    const hours = { start: 22, end: 6 };
    expect(nextPeriodSwitch(afternoon, "day", hours)).toEqual(new Date("2026-11-17T13:00:00Z"));
    expect(nextPeriodSwitch(afternoon, "night", hours)).toEqual(new Date("2026-11-17T21:00:00Z"));
  });

  it("夜の時間帯が無ければ、どちらへ切り替えても24時間後", () => {
    const later = new Date("2026-11-18T06:30:00Z");
    expect(nextPeriodSwitch(afternoon, "night", null)).toEqual(later);
    expect(nextPeriodSwitch(afternoon, "day", null)).toEqual(later);
  });
});

describe("resolveParallelState", () => {
  it("上書きが無ければ時間帯の決まりのとおり", () => {
    expect(resolveParallelState(afternoon, settings, null)).toEqual({ period: "day", limit: 3, override: null });
    expect(resolveParallelState(lateNight, settings, null)).toEqual({ period: "night", limit: 1, override: null });
  });

  it("効いている上書きが決まりに勝つ", () => {
    const state = resolveParallelState(afternoon, settings, "night until 2026-11-18T08:00+09:00");
    expect(state.period).toBe("night");
    expect(state.limit).toBe(1);
    expect(state.override?.until).toEqual(new Date("2026-11-17T23:00:00Z"));
  });

  it("期限を過ぎた上書き・形が違う上書きは無視する", () => {
    expect(resolveParallelState(afternoon, settings, "night until 2026-11-17T10:00+09:00").override).toBeNull();
    expect(resolveParallelState(afternoon, settings, "ぐちゃぐちゃ").period).toBe("day");
  });
});

describe("planParallelToggle", () => {
  it("昼に押すと、夜の終わりまでの夜の上書き", () => {
    expect(planParallelToggle(afternoon, settings, null)).toEqual({
      mode: "set",
      override: { period: "night", until: new Date("2026-11-17T23:00:00Z") },
    });
  });

  it("夜に押すと、次の夜の始まりまでの昼の上書き", () => {
    expect(planParallelToggle(lateNight, settings, null)).toEqual({
      mode: "set",
      override: { period: "day", until: new Date("2026-11-18T16:00:00Z") },
    });
  });

  it("夜の時間帯が無ければ、昼から夜へ24時間", () => {
    expect(planParallelToggle(afternoon, { ...settings, nightHours: null }, null)).toEqual({
      mode: "set",
      override: { period: "night", until: new Date("2026-11-18T06:30:00Z") },
    });
  });

  it("上書き中にもう一度押すと消す。期限を過ぎた上書きは無いのと同じ", () => {
    expect(planParallelToggle(afternoon, settings, "night until 2026-11-18T08:00+09:00")).toEqual({ mode: "clear" });
    expect(planParallelToggle(afternoon, settings, "night until 2026-11-17T08:00+09:00").mode).toBe("set");
  });
});

describe("describeParallelBar / describeParallelButton", () => {
  it("昼は 並列3、夜は 夜：1件ずつ（2以上なら 夜：並列2）", () => {
    expect(describeParallelBar({ period: "day", limit: 3, override: null })).toBe("並列3");
    expect(describeParallelBar({ period: "night", limit: 1, override: null })).toBe("夜：1件ずつ");
    expect(describeParallelBar({ period: "night", limit: 2, override: null })).toBe("夜：並列2");
  });

  it("ボタンの説明：押すとどうなるか、上書き中は期限も言う", () => {
    expect(describeParallelButton(resolveParallelState(afternoon, settings, null))).toContain("押すと夜に切り替える");
    expect(describeParallelButton(resolveParallelState(lateNight, settings, null))).toContain("押すと昼に切り替える");
    const text = describeParallelButton(resolveParallelState(afternoon, settings, "night until 2026-11-18T08:00+09:00"));
    expect(text).toContain("手動で切り替え中");
    expect(text).toContain("11/18 08:00 まで");
    expect(text).toContain("時間帯の決まりに戻す");
  });
});
