import { describe, expect, it } from "vitest";
import { ciProgress } from "../ciProgress";
import { queueGroups, queueRowMeta, queueRowTitle, workStepText } from "./queueGroups";
import { queueReasonText, type QueueEntry, type QueueReasonKind } from "./slots";
import type { SlotWork, WaitTarget } from "./source";

function work(number: number, stepAt = 2): SlotWork {
  return {
    key: `o/r#${number}`,
    owner: "o",
    repo: "r",
    number,
    title: `作業 ${number}`,
    url: `https://github.com/o/r/issues/${number}`,
    stepText: "実装しています",
    stepAt,
    stepName: "実装",
    elapsedMs: null,
    ci: null,
    touches: null,
  };
}

function target(number: number, running: boolean, kind: WaitTarget["kind"] = "issue"): WaitTarget {
  return { kind, number, title: `相手 ${number}`, running, issueNumber: number, url: `https://example.com/${number}` };
}

let rank = 0;
function entry(number: number, reasonKind: QueueReasonKind, waitFors: WaitTarget[] = [], file: string | null = null): QueueEntry {
  rank += 1;
  return {
    key: `o/r#${number}`,
    owner: "o",
    repo: "r",
    number,
    title: `待ち ${number}`,
    url: `https://github.com/o/r/issues/${number}`,
    cause: reasonKind === "full" || reasonKind === "ready" ? null : reasonKind,
    file,
    waitFor: null,
    waitFors,
    waitingMs: null,
    rank,
    reasonKind,
    reason: queueReasonText(reasonKind, file),
  };
}

/** まとまりを `[種類, 相手の番号, [[番号, 段, 子の番号, 待つ Queue の番号]]]` の形に */
function shape(groups: ReturnType<typeof queueGroups>) {
  return groups.map((group) => [
    group.kind,
    group.targets.map((t) => t.number),
    group.rows.map((row) => [row.entry.number, row.depth, row.order, row.after]),
  ]);
}

describe("queueGroups", () => {
  it("待つ相手ごとに分け、相手が動いている作業ならその作業のまとまり", () => {
    rank = 0;
    const queue = [
      entry(10, "overlap", [target(1, true)], "src/a.ts"),
      entry(11, "overlap", [target(2, true)]),
      entry(12, "overlap", [target(1, true)]),
    ];
    const groups = queueGroups(queue, [work(1), work(2)]);
    expect(shape(groups)).toEqual([
      ["work", [1], [[10, 1, 1, null], [12, 1, 2, null]]],
      ["work", [2], [[11, 1, 1, null]]],
    ]);
    expect(groups[0].work?.number).toBe(1);
    expect(groups[0].tone).toBe("running");
  });

  it("2つ以上の相手を待つ物は `#A + #B` のまとまりに1回だけ出し、同じ組み合わせは同じまとまり", () => {
    rank = 0;
    const queue = [
      entry(10, "overlap", [target(2, true), target(1, true)]),
      entry(11, "overlap", [target(1, true)]),
      entry(12, "overlap", [target(1, true), target(2, true)]),
    ];
    const groups = queueGroups(queue, [work(1), work(2)]);
    expect(shape(groups)).toEqual([
      ["work", [1], [[11, 1, 1, null]]],
      ["multi", [1, 2], [[10, 1, 1, null], [12, 1, 2, null]]],
    ]);
    expect(groups.flatMap((group) => group.rows).filter((row) => row.entry.number === 10)).toHaveLength(1);
    expect(groups[1].tone).toBe("running");
  });

  it("相手も Queue にいる物は、相手の行の下に2段目でぶら下げる。3段目以降も2段目に並べる", () => {
    rank = 0;
    const queue = [
      entry(10, "overlap", [target(1, true)]),
      entry(11, "blocked", [target(10, false)]),
      entry(12, "blocked", [target(11, false)]),
      entry(13, "blocked", [target(10, false)]),
    ];
    expect(shape(queueGroups(queue, [work(1)]))).toEqual([
      ["work", [1], [[10, 1, 1, null], [11, 2, 1, 10], [12, 2, 2, 11], [13, 2, 3, 10]]],
    ]);
  });

  it("互いを待ち合う物は、Queue で後ろの物の輪を切る", () => {
    rank = 0;
    const queue = [entry(10, "blocked", [target(11, false)]), entry(11, "blocked", [target(10, false)])];
    const groups = queueGroups(queue, []);
    expect(shape(groups)).toEqual([["idle", [10], [[11, 1, 1, null], [10, 2, 1, 11]]]]);
    expect(groups[0].tone).toBe("queue");
  });

  it("相手が動いても Queue にもいない物は灰色の親。誰も待たない物は `Next free slot`", () => {
    rank = 0;
    const queue = [
      entry(10, "full"),
      entry(11, "blocked", [target(40, false)]),
      entry(12, "hold", [target(36, false, "pull")]),
      entry(13, "ready"),
      entry(14, "blocked"),
    ];
    const groups = queueGroups(queue, []);
    expect(shape(groups)).toEqual([
      ["idle", [36], [[12, 1, 1, null]]],
      ["idle", [40], [[11, 1, 1, null]]],
      ["next", [], [[10, 1, 1, null], [13, 1, 2, null], [14, 1, 3, null]]],
    ]);
    expect(groups.map((group) => group.tone)).toEqual(["idle", "idle", "idle"]);
  });

  it("触るファイルの印が無い物は、同じリポジトリの動いている作業すべてを待つ", () => {
    rank = 0;
    const groups = queueGroups([entry(10, "noTouches")], [work(2), work(1)]);
    expect(shape(groups)).toEqual([["multi", [1, 2], [[10, 1, 1, null]]]]);
  });

  it("並び：相手の工程が先に進んでいる物ほど上、同じなら番号の小さい順。動いていない相手は後ろ、`Next free slot` は最後", () => {
    rank = 0;
    const queue = [
      entry(10, "full"),
      entry(11, "blocked", [target(40, false)]),
      entry(12, "overlap", [target(3, true)]),
      entry(13, "overlap", [target(1, true)]),
      entry(14, "overlap", [target(2, true)]),
      entry(15, "overlap", [target(1, true), target(3, true)]),
    ];
    const groups = queueGroups(queue, [work(1, 2), work(2, 4), work(3, 2)]);
    expect(groups.map((group) => [group.kind, group.targets.map((t) => t.number)])).toEqual([
      ["work", [2]],
      ["work", [1]],
      ["multi", [1, 3]],
      ["work", [3]],
      ["idle", [40]],
      ["next", []],
    ]);
  });

  it("Queue が無ければまとまりも無い", () => {
    expect(queueGroups([], [work(1)])).toEqual([]);
  });
});

describe("子の行の文", () => {
  it("番号とファイル名（パスの最後）。2段目は待つ Queue の番号", () => {
    rank = 0;
    const one = entry(556, "overlap", [target(1, true)], "src/components/TopBar.tsx");
    expect(queueRowMeta({ entry: one, order: 1, depth: 1, after: null })).toBe("r#556 · TopBar.tsx");
    expect(queueRowMeta({ entry: entry(557, "full"), order: 1, depth: 1, after: null })).toBe("r#557");
    expect(queueRowMeta({ entry: entry(590, "blocked"), order: 1, depth: 2, after: 556 })).toBe("r#590 · #556 のあと");
    expect(queueRowMeta({ entry: entry(591, "overlap", [], "src/lib/"), order: 1, depth: 1, after: null })).toBe("r#591 · lib");
  });

  it("title は全体の順と理由の文", () => {
    rank = 2;
    expect(queueRowTitle(entry(10, "overlap", [], "src/a.ts"))).toBe("全体で 3番目 · 触るファイルが重なる（src/a.ts）");
  });

  it("相手の工程の文は、Slots の行と同じ（CI の段は CI の文）", () => {
    expect(workStepText(work(1))).toBe("実装しています");
    const ci: SlotWork = {
      ...work(2, 3),
      ci: ciProgress({ passed: 4, total: 10, running: 0, queued: 6, failed: 0 }),
    };
    expect(workStepText(ci)).toBe("4/7 CI ✓4 ⧗6 開始待ち");
  });
});
