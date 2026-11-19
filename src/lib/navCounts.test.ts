import { describe, expect, it } from "vitest";
import {
  applyRepoCount,
  countText,
  fullNavCounts,
  isRepoCountPending,
  isRepoCountUnavailable,
  NO_NAV_COUNTS,
  slotsInUseOf,
  unreadableMapOf,
  withPageCounts,
  withRepoCount,
} from "./navCounts";

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
    expect(first).toEqual({
      counts: { byRepo: { "o/a": 2 } },
      runningCounts: { byRepo: {} },
      loaded: { "o/a": true },
      unreadable: {},
    });
    const second = applyRepoCount(first, { key: "o/b", turn: 0, running: 1, renderedAt: T1 }, null);
    expect(second).toEqual({
      counts: { byRepo: { "o/a": 2 } },
      runningCounts: { byRepo: { "o/b": 1 } },
      loaded: { "o/a": true, "o/b": true },
      unreadable: {},
    });
  });

  it("読めなかったリポジトリは「届いた」にせず、読めなかった印を入れる。読めたら外れる", () => {
    const before = fullNavCounts({ byRepo: { "o/a": 2 } }, { byRepo: {} }, ["o/a", "o/b"]);
    const failed = applyRepoCount(before, { key: "o/a", turn: 0, running: 0, renderedAt: T1, unreadable: true }, null);
    expect(failed.unreadable).toEqual({ "o/a": true });
    expect(failed.loaded).toEqual({ "o/b": true });
    expect(failed.counts).toEqual({ byRepo: {} });
    const back = applyRepoCount(failed, { key: "o/a", turn: 2, running: 0, renderedAt: T2 }, null);
    expect(back.unreadable).toEqual({});
    expect(back.loaded).toEqual({ "o/a": true, "o/b": true });
    expect(back.counts).toEqual({ byRepo: { "o/a": 2 } });
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

describe("fullNavCounts（読めなかったリポジトリ）", () => {
  it("読めなかった物は「届いた」にならず、読めなかった印が入る（小文字）", () => {
    const full = fullNavCounts({ byRepo: {} }, { byRepo: {} }, ["o/a", "o/b"], ["O/B"]);
    expect(full.loaded).toEqual({ "o/a": true });
    expect(full.unreadable).toEqual({ "o/b": true });
  });
});

describe("countText", () => {
  it("分からないとき（読み込み中・読めなかった）は「–」、そうでなければ0も含めて数", () => {
    expect(countText(0, true)).toBe("–");
    expect(countText(3, true)).toBe("–");
    expect(countText(0, false)).toBe("0");
    expect(countText(3, false)).toBe("3");
  });
});

describe("slotsInUseOf", () => {
  it("読めなかったリポジトリが1つでもあれば null（「–」）。無ければ数のまま", () => {
    expect(slotsInUseOf(6, 0)).toBe(6);
    expect(slotsInUseOf(0, 0)).toBe(0);
    expect(slotsInUseOf(6, 1)).toBeNull();
    expect(slotsInUseOf(0, 2)).toBeNull();
  });
});

describe("unreadableMapOf", () => {
  it("読めなかったリポジトリを小文字の鍵の表にする", () => {
    expect(unreadableMapOf([{ repo: "Owner/A" }, { repo: "o/b" }])).toEqual({ "owner/a": true, "o/b": true });
    expect(unreadableMapOf([])).toEqual({});
  });
});

describe("isRepoCountUnavailable", () => {
  it("読めなかったリポジトリは、全部が届いた後でも「–」", () => {
    expect(isRepoCountUnavailable(false, {}, { "o/a": true }, "O/A")).toBe(true);
    expect(isRepoCountUnavailable(false, {}, {}, "o/a")).toBe(false);
    expect(isRepoCountUnavailable(false, undefined, undefined, "o/a")).toBe(false);
  });

  it("届く前は、届いていない物が「–」。読めた物は数", () => {
    expect(isRepoCountUnavailable(true, { "o/a": true }, {}, "o/a")).toBe(false);
    expect(isRepoCountUnavailable(true, { "o/a": true }, {}, "o/b")).toBe(true);
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

describe("withPageCounts", () => {
  const page = { counts: { byRepo: { "o/a": 1 } }, runningCounts: { byRepo: {} }, unreadable: {}, repoKeys: ["o/a", "o/b"] };
  it("ページが数えた件数で入れ替える。古い件数は残らない", () => {
    const old = fullNavCounts({ byRepo: {} }, { byRepo: {} }, ["o/a", "o/b"]);
    const next = withPageCounts(old, page);
    expect(next.counts).toEqual({ byRepo: { "o/a": 1 } });
    expect(next.loaded).toEqual({ "o/a": true, "o/b": true });
  });
  it("同じ件数なら同じ物を返す", () => {
    const once = withPageCounts(NO_NAV_COUNTS, page);
    expect(withPageCounts(once, page)).toBe(once);
  });
});
