import { describe, expect, it } from "vitest";
import { resolveParallelState, type ParallelSettings } from "./parallel";
import {
  describeNextParallelChange,
  describeParallelFolded,
  describeParallelUsage,
  parallelBadge,
  parallelCells,
  parallelChoiceLabel,
  parallelChoiceValue,
  selectedParallelChoice,
} from "./parallelSwitch";

const settings: ParallelSettings = { day: 5, night: 1, nightHours: { start: 23, end: 7 } };
// 日本時間 2026-11-19 03:00（夜）／12:00（昼）
const NIGHT = new Date("2026-11-18T18:00:00Z");
const DAY = new Date("2026-11-19T03:00:00Z");

describe("3択の書く値", () => {
  it("自動は上書きを消し、1件・5件は夜・昼の上書き", () => {
    expect(parallelChoiceValue("auto")).toBe("clear");
    expect(parallelChoiceValue("night")).toBe("night");
    expect(parallelChoiceValue("day")).toBe("day");
  });

  it("文字は設定の値から出す", () => {
    expect(parallelChoiceLabel("auto", settings)).toBe("自動");
    expect(parallelChoiceLabel("night", settings)).toBe("1件");
    expect(parallelChoiceLabel("day", settings)).toBe("5件");
  });

  it("選ばれている物は、上書きがあればその時間帯、無ければ自動", () => {
    expect(selectedParallelChoice(resolveParallelState(NIGHT, settings, null))).toBe("auto");
    const manual = resolveParallelState(NIGHT, settings, "day until 2026-11-19T08:00+09:00");
    expect(selectedParallelChoice(manual)).toBe("day");
  });
});

describe("札", () => {
  it("夜の自動・昼の自動・手動", () => {
    expect(parallelBadge(resolveParallelState(NIGHT, settings, null))).toBe("自動 · 夜");
    expect(parallelBadge(resolveParallelState(DAY, settings, null))).toBe("自動 · 昼");
    expect(parallelBadge(resolveParallelState(DAY, settings, "night until 2026-11-19T23:00+09:00"))).toBe("手動");
  });
});

describe("マス", () => {
  it("夜：使っている1席、残りは使えない席（昼の数ぶん）", () => {
    const state = resolveParallelState(NIGHT, settings, null);
    expect(parallelCells(1, settings, state)).toEqual(["used", "unavailable", "unavailable", "unavailable", "unavailable"]);
  });

  it("昼：使っている席・空いている席", () => {
    const state = resolveParallelState(DAY, settings, null);
    expect(parallelCells(3, settings, state)).toEqual(["used", "used", "used", "free", "free"]);
  });

  it("上限より多く動いているときは、動いている数ぶん出す", () => {
    const state = resolveParallelState(NIGHT, settings, null);
    expect(parallelCells(7, settings, state)).toHaveLength(7);
    expect(parallelCells(7, settings, state).every((cell) => cell === "used")).toBe(true);
  });

  it("使用中の数が分からないとき（null）は使っている席を出さない", () => {
    const state = resolveParallelState(DAY, settings, null);
    expect(parallelCells(null, settings, state)).toEqual(["free", "free", "free", "free", "free"]);
  });
});

describe("次に変わる時刻の文", () => {
  it("夜の自動は、夜の終わりから昼の数", () => {
    expect(describeNextParallelChange(resolveParallelState(NIGHT, settings, null), settings)).toBe("7:00 から 5件");
  });

  it("昼の自動は、夜の始まりから夜の数", () => {
    expect(describeNextParallelChange(resolveParallelState(DAY, settings, null), settings)).toBe("23:00 から 1件ずつ");
  });

  it("手動は、期限に自動へ戻る", () => {
    const manual = resolveParallelState(NIGHT, settings, "day until 2026-11-19T07:00+09:00");
    expect(describeNextParallelChange(manual, settings)).toBe("7:00 に自動へ戻る");
  });

  it("夜の時間帯が無い自動は出さない", () => {
    const none = { ...settings, nightHours: null };
    expect(describeNextParallelChange(resolveParallelState(DAY, none, null), none)).toBeNull();
  });
});

describe("4行目と畳んだ1行", () => {
  it("使用中の数・上限・次の変わり目", () => {
    expect(describeParallelUsage(1, resolveParallelState(NIGHT, settings, null), settings)).toBe(
      "1 / 1 使用中 · 7:00 から 5件",
    );
    expect(describeParallelUsage(3, resolveParallelState(DAY, settings, null), settings)).toBe(
      "3 / 5 使用中 · 23:00 から 1件ずつ",
    );
  });

  it("数が分からないときは –", () => {
    const none = { ...settings, nightHours: null };
    expect(describeParallelUsage(null, resolveParallelState(DAY, none, null), none)).toBe("– / 5 使用中");
  });

  it("畳んだ1行の説明", () => {
    expect(describeParallelFolded(1, resolveParallelState(NIGHT, settings, null))).toBe(
      "同時に動かす：1件まで（自動 · 夜）。1 / 1 使用中",
    );
  });
});
