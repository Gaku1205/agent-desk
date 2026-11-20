import { describe, expect, it } from "vitest";
import { fillFromLastShown, lastShownOf, NO_LAST_SHOWN, parseLastShown, restToShow } from "./lastShown";

describe("parseLastShown", () => {
  it("壊れた文字列は何も覚えていない扱い", () => {
    expect(parseLastShown(null)).toEqual(NO_LAST_SHOWN);
    expect(parseLastShown("{")).toEqual(NO_LAST_SHOWN);
    expect(parseLastShown("1")).toEqual(NO_LAST_SHOWN);
  });
  it("数を読む（不正な物は捨てる）", () => {
    const raw = JSON.stringify({ repos: { "A/b": { turn: 2, running: 1 }, c: { turn: -1, running: 0 } }, slotsInUse: 0, rest: "x" });
    expect(parseLastShown(raw)).toEqual({ repos: { "a/b": { turn: 2, running: 1 } }, slotsInUse: 0, rest: null });
  });
});

describe("fillFromLastShown", () => {
  const last = { repos: { "o/a": { turn: 2, running: 0 }, "o/b": { turn: 0, running: 1 } }, slotsInUse: 1, rest: 2 };
  it("届いていないリポジトリを前の数で埋め、届いた物は変えない", () => {
    const filled = fillFromLastShown({ byRepo: { "o/a": 1 } }, { byRepo: {} }, { "o/a": true }, last);
    expect(filled.counts.byRepo).toEqual({ "o/a": 1 });
    expect(filled.runningCounts.byRepo).toEqual({ "o/b": 1 });
    expect(filled.loaded).toEqual({ "o/a": true, "o/b": true });
  });
});

describe("lastShownOf", () => {
  it("読めなかったリポジトリは前の数を残す", () => {
    const previous = { repos: { "o/a": { turn: 3, running: 0 } }, slotsInUse: 2, rest: 1 };
    const next = lastShownOf({ byRepo: { "o/b": 1 } }, { byRepo: {} }, ["o/a", "o/b"], { "o/a": true }, null, previous);
    expect(next.repos).toEqual({ "o/a": { turn: 3, running: 0 }, "o/b": { turn: 1, running: 0 } });
    expect(next.slotsInUse).toBe(2);
  });
});

describe("restToShow", () => {
  it("そろうまでは前の数、そろったら実際の数", () => {
    expect(restToShow(1, false, 3)).toBe(3);
    expect(restToShow(1, false, null)).toBeNull();
    expect(restToShow(1, true, 3)).toBe(1);
  });
});
