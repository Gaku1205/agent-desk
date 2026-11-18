import { describe, expect, it } from "vitest";
import { isMergeQueueItem, orderMergeQueue } from "./mergeOrder";
import { pullOnlyStatus, type TurnItem } from "./turn";
import type { PullData } from "./github/types";

function pull(number: number): PullData {
  return {
    number,
    title: `PR ${number}`,
    body: "",
    state: "open",
    merged: false,
    labels: ["ai:hold"],
    url: `https://github.com/o/r/pull/${number}`,
    headRef: `feature-${number}`,
    headSha: "abc",
    mergeCommitSha: null,
    createdAt: "2026-11-18T00:00:00Z",
    updatedAt: "2026-11-18T00:00:00Z",
    mergedAt: null,
  };
}

function item(number: number, over: Partial<TurnItem> & { repo?: string } = {}): TurnItem {
  const p = pull(number);
  return {
    owner: "o",
    repo: "r",
    issue: { number, title: p.title, url: p.url },
    status: pullOnlyStatus(p, { passed: 4, total: 4 }),
    description: "",
    note: null,
    logUrl: null,
    waitingSince: "2026-11-18T00:00:00Z",
    buttons: [{ type: "operation", kind: "merge", label: "マージ…" }],
    merge: { pullNumber: number, base: "main", ci: { passed: 4, total: 4 }, review: "clean" },
    question: null,
    factory: null,
    pullOnly: true,
    ...over,
  };
}

const numbers = (items: TurnItem[]) => items.map((i) => i.issue.number);

describe("orderMergeQueue", () => {
  it("PR番号の小さい順に並べる（ほかが同じとき）", () => {
    expect(numbers(orderMergeQueue([item(30), item(10), item(20)]))).toEqual([10, 20, 30]);
  });

  it("止めている数が多い物を先にする", () => {
    const ordered = orderMergeQueue([
      item(10),
      item(20, { blocking: [1] }),
      item(30, { blocking: [1, 2] }),
    ]);
    expect(numbers(ordered)).toEqual([30, 20, 10]);
  });

  it("止めている印が、重なりより先に効く", () => {
    const ordered = orderMergeQueue([
      item(10, { files: ["a.ts"] }),
      item(20, { files: ["a.ts"] }),
      item(30, { blocking: [5] }),
    ]);
    expect(numbers(ordered)[0]).toBe(30);
  });

  it("触るファイルが重なる相手が多い物を先にする", () => {
    const ordered = orderMergeQueue([
      item(10, { files: ["x.ts"] }),
      item(20, { files: ["a.ts"] }),
      item(30, { files: ["a.ts", "b.ts"] }),
      item(40, { files: ["b.ts"] }),
    ]);
    // 30 は 20 と 40 の2件と重なる。20 と 40 は 30 の1件。10 は無し
    expect(numbers(ordered)).toEqual([30, 20, 40, 10]);
  });

  it("別のリポジトリとは、同じファイル名でも重ならない", () => {
    const ordered = orderMergeQueue([
      item(10, { files: ["a.ts"] }),
      item(20, { files: ["a.ts"], repo: "other" } as Partial<TurnItem>),
      item(5, { files: ["z.ts"] }),
    ]);
    // 重なりは無いので、PR番号の小さい順
    expect(numbers(ordered)).toEqual([5, 10, 20]);
  });

  it("変更ファイルが無い物は重なり無しとして、PR番号で決める", () => {
    expect(numbers(orderMergeQueue([item(20), item(10, { files: [] })]))).toEqual([10, 20]);
  });

  it("元の並びを変えない", () => {
    const input = [item(30), item(10)];
    orderMergeQueue(input);
    expect(numbers(input)).toEqual([30, 10]);
  });
});

describe("isMergeQueueItem", () => {
  it("マージのボタンがある ai:hold のマージ待ちだけ", () => {
    expect(isMergeQueueItem(item(10))).toBe(true);
    expect(isMergeQueueItem(item(10, { merge: null, buttons: [] }))).toBe(false);
  });
});
