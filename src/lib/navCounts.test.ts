import { describe, expect, it } from "vitest";
import { applyRepoCount, fullNavCounts, isRepoCountPending, NO_NAV_COUNTS, withRepoCount } from "./navCounts";

const T1 = "2026-11-18T03:00:00.000Z";
const T2 = "2026-11-18T03:00:20.000Z";

describe("withRepoCount", () => {
  it("そのリポジトリの件数だけを入れ替える。0件は持たない", () => {
    const counts = { byRepo: { "o/a": 2, "o/b": 1 } };
    expect(withRepoCount(counts, "o/a", 5)).toEqual({ byRepo: { "o/a": 5, "o/b": 1 } });
    expect(withRepoCount(counts, "o/b", 0)).toEqual({ byRepo: { "o/a": 2 } });
    expect(withRepoCount(counts, "o/c", 3)).toEqual({ byRepo: { "o/a": 2, "o/b": 1, "o/c": 3 } });
    // 元の物は書き換えない
    expect(counts).toEqual({ byRepo: { "o/a": 2, "o/b": 1 } });
  });
});

describe("applyRepoCount", () => {
  it("読み終えたリポジトリから順に、件数と「届いた」印が入る", () => {
    const first = applyRepoCount(NO_NAV_COUNTS, { key: "o/a", turn: 2, running: 0, renderedAt: T1 }, null);
    expect(first).toEqual({ counts: { byRepo: { "o/a": 2 } }, runningCounts: { byRepo: {} }, loaded: { "o/a": true } });
    const second = applyRepoCount(first, { key: "o/b", turn: 0, running: 1, renderedAt: T1 }, null);
    expect(second).toEqual({
      counts: { byRepo: { "o/a": 2 } },
      runningCounts: { byRepo: { "o/b": 1 } },
      loaded: { "o/a": true, "o/b": true },
    });
  });

  it("同期のとき：前の数を残したまま、読み終えたリポジトリだけ新しい数になる", () => {
    const before = fullNavCounts({ byRepo: { "o/a": 2, "o/b": 1 } }, { byRepo: { "o/b": 1 } }, ["o/a", "o/b"]);
    const after = applyRepoCount(before, { key: "o/b", turn: 3, running: 0, renderedAt: T2 }, T1);
    expect(after.counts).toEqual({ byRepo: { "o/a": 2, "o/b": 3 } });
    expect(after.runningCounts).toEqual({ byRepo: {} });
  });

  it("全部を読み終えた結果より前の描画の件数は、古いので入れない。同じ描画・時刻が読めない物は入れる", () => {
    const full = fullNavCounts({ byRepo: { "o/a": 2 } }, { byRepo: {} }, ["o/a"]);
    expect(applyRepoCount(full, { key: "o/a", turn: 9, running: 0, renderedAt: T1 }, T2)).toBe(full);
    expect(applyRepoCount(full, { key: "o/a", turn: 9, running: 0, renderedAt: T2 }, T2).counts.byRepo["o/a"]).toBe(9);
    expect(applyRepoCount(full, { key: "o/a", turn: 9, running: 0, renderedAt: "x" }, T2).counts.byRepo["o/a"]).toBe(9);
  });
});

describe("fullNavCounts", () => {
  it("監視しているリポジトリは全部「届いた」になる（小文字）", () => {
    expect(fullNavCounts({ byRepo: {} }, { byRepo: {} }, ["Owner/A", "o/b"]).loaded).toEqual({ "owner/a": true, "o/b": true });
  });
});

describe("isRepoCountPending", () => {
  it("全部が届く前は、届いていないリポジトリだけ「–」", () => {
    expect(isRepoCountPending(true, { "o/a": true }, "o/a")).toBe(false);
    expect(isRepoCountPending(true, { "o/a": true }, "O/A")).toBe(false);
    expect(isRepoCountPending(true, { "o/a": true }, "o/b")).toBe(true);
    expect(isRepoCountPending(true, undefined, "o/a")).toBe(true);
  });

  it("全部が届いた後は「–」にしない", () => {
    expect(isRepoCountPending(false, {}, "o/a")).toBe(false);
    expect(isRepoCountPending(false, undefined, "o/a")).toBe(false);
  });
});
