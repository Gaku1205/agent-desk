import { describe, expect, it } from "vitest";
import { heldPausedIndex, withHeldPaused, type HeldPaused } from "./pausedHold";
import type { PausedEntry } from "./source";

function entry(number: number): PausedEntry {
  return {
    key: `o/r#${number}`,
    owner: "o",
    repo: "r",
    number,
    title: `t${number}`,
    url: "",
    reason: "理由",
    pausedAt: null,
  } as PausedEntry;
}

describe("withHeldPaused", () => {
  const list = [entry(1), entry(2), entry(3)];

  it("預かりが無ければ、そのまま", () => {
    expect(withHeldPaused(list, new Map())).toEqual(list);
  });

  it("一覧から外れた行は、押した時点の位置に戻す", () => {
    const held = new Map<string, HeldPaused>([["o/r#2", { entry: entry(2), index: 1 }]]);
    const fresh = [entry(1), entry(3)];
    expect(withHeldPaused(fresh, held).map((e) => e.number)).toEqual([1, 2, 3]);
  });

  it("一覧にまだある行は押した時点の中身に置き換える", () => {
    const old = { ...entry(2), reason: "押した時点" };
    const held = new Map<string, HeldPaused>([["o/r#2", { entry: old, index: 1 }]]);
    expect(withHeldPaused(list, held)[1].reason).toBe("押した時点");
  });

  it("位置が一覧より後ろでも末尾に入る", () => {
    const held = new Map<string, HeldPaused>([["o/r#9", { entry: entry(9), index: 7 }]]);
    expect(withHeldPaused([entry(1)], held).map((e) => e.number)).toEqual([1, 9]);
  });

  it("片づけ済みの行は出さない", () => {
    expect(withHeldPaused(list, new Map(), new Set(["o/r#1"])).map((e) => e.number)).toEqual([2, 3]);
  });
});

describe("heldPausedIndex", () => {
  const list = [entry(1), entry(2)];
  it("預かり済みなら、その位置のまま", () => {
    expect(heldPausedIndex({ entry: entry(2), index: 5 }, list, "o/r#2")).toBe(5);
  });
  it("初めてなら一覧での位置、無ければ 0", () => {
    expect(heldPausedIndex(undefined, list, "o/r#2")).toBe(1);
    expect(heldPausedIndex(undefined, list, "o/r#9")).toBe(0);
  });
});
