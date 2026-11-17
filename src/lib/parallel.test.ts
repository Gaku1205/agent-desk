import { describe, expect, it } from "vitest";
import {
  buildParallelWrites,
  checkParallelSettings,
  currentParallelLimit,
  currentPeriod,
  DEFAULT_PARALLEL_SETTINGS,
  describeParallelNow,
  formatNightHours,
  hourInZone,
  isNightHour,
  PARALLEL_MESSAGES,
  parseNightHours,
  parseParallelCount,
  parseParallelSettings,
  sameParallelSettings,
} from "./parallel";

describe("parseParallelCount", () => {
  it("1以上の整数を読む", () => {
    expect(parseParallelCount("5", 3)).toBe(5);
    expect(parseParallelCount(" 12 ", 3)).toBe(12);
  });

  it("不正な値は既定に戻す", () => {
    for (const bad of [null, undefined, "", "0", "-1", "2.5", "abc", "3件", "1e2", "99999999999999999999"]) {
      expect(parseParallelCount(bad, 3)).toBe(3);
    }
  });
});

describe("parseNightHours", () => {
  it("HH-HH を読む（日またぎも）", () => {
    expect(parseNightHours("01-08")).toEqual({ start: 1, end: 8 });
    expect(parseNightHours("22-06")).toEqual({ start: 22, end: 6 });
    expect(parseNightHours("0-24")).toEqual({ start: 0, end: 24 });
  });

  it("無い・空・形が違う・範囲外・同じ時刻は null（夜は無し）", () => {
    for (const bad of [null, undefined, "", "1", "1-", "-8", "aa-bb", "01:00-08:00", "01-25", "25-01", "-1-5", "08-08", "1-2-3"]) {
      expect(parseNightHours(bad)).toBeNull();
    }
  });
});

describe("parseParallelSettings", () => {
  it("何も無ければ既定（昼3・夜1・夜の時間帯なし）", () => {
    expect(parseParallelSettings({ day: null, night: null, nightHours: null })).toEqual(
      DEFAULT_PARALLEL_SETTINGS,
    );
  });

  it("値を読み、不正な物だけ既定に戻す", () => {
    expect(parseParallelSettings({ day: "6", night: "0", nightHours: "23-07" })).toEqual({
      day: 6,
      night: 1,
      nightHours: { start: 23, end: 7 },
    });
  });
});

describe("formatNightHours", () => {
  it("2桁にそろえる", () => {
    expect(formatNightHours({ start: 1, end: 8 })).toBe("01-08");
    expect(formatNightHours({ start: 22, end: 6 })).toBe("22-06");
  });
});

describe("checkParallelSettings", () => {
  it("正しい設定を通す", () => {
    expect(checkParallelSettings({ day: 5, night: 2, nightHours: { start: 1, end: 8 } })).toEqual({
      ok: true,
      settings: { day: 5, night: 2, nightHours: { start: 1, end: 8 } },
    });
    expect(checkParallelSettings({ day: 3, night: 1, nightHours: null })).toEqual({
      ok: true,
      settings: { day: 3, night: 1, nightHours: null },
    });
  });

  it("0以下・小数・数でない並列の数は断る", () => {
    for (const bad of [0, -1, 1.5, "3", null, undefined, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(checkParallelSettings({ day: bad, night: 1, nightHours: null })).toEqual({
        ok: false,
        message: PARALLEL_MESSAGES.count,
      });
      expect(checkParallelSettings({ day: 3, night: bad, nightHours: null })).toEqual({
        ok: false,
        message: PARALLEL_MESSAGES.count,
      });
    }
  });

  it("時間帯の形が違う物・範囲外・同じ時刻は断る", () => {
    const base = { day: 3, night: 1 };
    expect(checkParallelSettings({ ...base, nightHours: "01-08" }).ok).toBe(false);
    expect(checkParallelSettings({ ...base, nightHours: undefined }).ok).toBe(false);
    expect(checkParallelSettings({ ...base, nightHours: [1, 8] }).ok).toBe(false);
    for (const hours of [
      { start: -1, end: 8 },
      { start: 1, end: 24 },
      { start: 1.5, end: 8 },
      { start: "1", end: 8 },
      { start: 1 },
    ]) {
      expect(checkParallelSettings({ ...base, nightHours: hours })).toEqual({
        ok: false,
        message: PARALLEL_MESSAGES.hours,
      });
    }
    expect(checkParallelSettings({ ...base, nightHours: { start: 5, end: 5 } })).toEqual({
      ok: false,
      message: PARALLEL_MESSAGES.sameHours,
    });
  });

  it("オブジェクトでない入力は断る", () => {
    for (const bad of [null, undefined, "x", 3, []]) {
      expect(checkParallelSettings(bad)).toEqual({ ok: false, message: PARALLEL_MESSAGES.invalid });
    }
  });
});

describe("buildParallelWrites", () => {
  it("既定と違う値だけを書き、既定と同じ・無しは消す", () => {
    expect(buildParallelWrites({ day: 5, night: 2, nightHours: { start: 1, end: 8 } })).toEqual([
      { name: "PARALLEL_DAY", value: "5" },
      { name: "PARALLEL_NIGHT", value: "2" },
      { name: "PARALLEL_NIGHT_HOURS", value: "01-08" },
    ]);
    expect(buildParallelWrites(DEFAULT_PARALLEL_SETTINGS)).toEqual([
      { name: "PARALLEL_DAY", value: null },
      { name: "PARALLEL_NIGHT", value: null },
      { name: "PARALLEL_NIGHT_HOURS", value: null },
    ]);
  });

  it("PARALLEL_TZ・PARALLEL_OVERRIDE には触らない", () => {
    const names = buildParallelWrites({ day: 5, night: 2, nightHours: null }).map((w) => w.name);
    expect(names).not.toContain("PARALLEL_TZ");
    expect(names).not.toContain("PARALLEL_OVERRIDE");
  });
});

describe("sameParallelSettings", () => {
  it("中身が同じなら true", () => {
    const a = { day: 3, night: 1, nightHours: { start: 1, end: 8 } };
    expect(sameParallelSettings(a, { ...a, nightHours: { start: 1, end: 8 } })).toBe(true);
    expect(sameParallelSettings(a, { ...a, nightHours: null })).toBe(false);
    expect(sameParallelSettings(a, { ...a, day: 4 })).toBe(false);
  });
});

describe("isNightHour", () => {
  it("開始を含み、終了を含まない", () => {
    const hours = { start: 1, end: 8 };
    expect(isNightHour(0, hours)).toBe(false);
    expect(isNightHour(1, hours)).toBe(true);
    expect(isNightHour(7, hours)).toBe(true);
    expect(isNightHour(8, hours)).toBe(false);
  });

  it("日をまたぐ時間帯", () => {
    const hours = { start: 22, end: 6 };
    expect(isNightHour(21, hours)).toBe(false);
    expect(isNightHour(22, hours)).toBe(true);
    expect(isNightHour(23, hours)).toBe(true);
    expect(isNightHour(0, hours)).toBe(true);
    expect(isNightHour(5, hours)).toBe(true);
    expect(isNightHour(6, hours)).toBe(false);
    expect(isNightHour(12, hours)).toBe(false);
  });

  it("24は日の終わり、無しならいつも昼", () => {
    expect(isNightHour(23, { start: 22, end: 24 })).toBe(true);
    expect(isNightHour(0, { start: 22, end: 24 })).toBe(false);
    expect(isNightHour(12, null)).toBe(false);
  });
});

describe("タイムゾーン", () => {
  // 2026-11-17T16:00:00Z = 東京で 11/18 01:00 = ニューヨークで 11/17 11:00
  const now = new Date("2026-11-17T16:00:00Z");

  it("基準のタイムゾーンでの時刻を出す", () => {
    expect(hourInZone(now, "Asia/Tokyo")).toBe(1);
    expect(hourInZone(now, "America/New_York")).toBe(11);
    expect(hourInZone(now, "UTC")).toBe(16);
  });

  it("0時は0（24ではない）", () => {
    expect(hourInZone(new Date("2026-11-17T15:00:00Z"), "Asia/Tokyo")).toBe(0);
  });

  it("不正なタイムゾーンは Asia/Tokyo", () => {
    expect(hourInZone(now, "Not/AZone")).toBe(1);
  });

  it("同じ時刻でも、基準が違えば昼夜が変わる", () => {
    const hours = { start: 1, end: 8 };
    expect(currentPeriod(now, hours, "Asia/Tokyo")).toBe("night");
    expect(currentPeriod(now, hours, "America/New_York")).toBe("day");
    expect(currentPeriod(now, hours)).toBe("night");
  });
});

describe("currentParallelLimit / describeParallelNow", () => {
  const settings = { day: 3, night: 1, nightHours: { start: 1, end: 8 } };
  const night = new Date("2026-11-17T16:00:00Z"); // 東京 01:00（夜の始まり）
  const dayTime = new Date("2026-11-17T23:00:00Z"); // 東京 08:00（夜の終わり＝昼）

  it("夜は夜の数、昼は昼の数", () => {
    expect(currentParallelLimit(night, settings)).toBe(1);
    expect(currentParallelLimit(dayTime, settings)).toBe(3);
  });

  it("一文：昼・夜・夜の時間帯なし", () => {
    expect(describeParallelNow(dayTime, settings)).toBe("いまは昼：並列3");
    expect(describeParallelNow(night, settings)).toBe("いまは夜：1件ずつ");
    expect(describeParallelNow(night, { ...settings, night: 2 })).toBe("いまは夜：並列2");
    expect(describeParallelNow(night, { ...settings, nightHours: null })).toBe("夜の時間帯はありません");
  });

  it("日またぎの時間帯でも正しい", () => {
    const wrap = { day: 4, night: 1, nightHours: { start: 22, end: 6 } };
    expect(describeParallelNow(new Date("2026-11-17T14:00:00Z"), wrap)).toBe("いまは夜：1件ずつ"); // 東京 23:00
    expect(describeParallelNow(new Date("2026-11-17T18:00:00Z"), wrap)).toBe("いまは夜：1件ずつ"); // 東京 03:00
    expect(describeParallelNow(new Date("2026-11-17T03:00:00Z"), wrap)).toBe("いまは昼：並列4"); // 東京 12:00
  });
});
