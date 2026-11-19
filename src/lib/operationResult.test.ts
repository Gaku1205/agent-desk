import { describe, expect, it } from "vitest";
import type { PullData } from "./github/types";
import {
  doneSummary,
  heldIndex,
  OPERATION_COPY,
  startsText,
  withHeldRows,
  type HeldRow,
} from "./operationResult";
import { OPERATION_KINDS, pullOnlyStatus, turnItemKey, type TurnItem } from "./turn";

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

function item(number: number, over: Partial<TurnItem> = {}): TurnItem {
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

function held(rows: { item: TurnItem; index: number; done?: boolean }[]): Map<string, HeldRow<TurnItem>> {
  return new Map(rows.map((r) => [turnItemKey(r.item), { item: r.item, index: r.index, done: r.done ?? true }]));
}

describe("OPERATION_COPY", () => {
  it("どの操作にも、押している間（〜中…）・していること・結果の文言がある", () => {
    for (const kind of OPERATION_KINDS) {
      const copy = OPERATION_COPY[kind];
      expect(copy.busy.endsWith("中…") || copy.busy.endsWith("います…")).toBe(true);
      expect(copy.doing).not.toBe("");
      expect(copy.done.endsWith("ました")).toBe(true);
    }
  });

  it("マージは「マージ中…」→「マージしました」、答えは「送信中…」→「送りました」", () => {
    expect(OPERATION_COPY.merge).toEqual({
      busy: "マージ中…",
      doing: "GitHub でマージしています",
      done: "マージしました",
    });
    expect(OPERATION_COPY.answer.busy).toBe("送信中…");
    expect(OPERATION_COPY.answer.done).toBe("送りました");
    expect(OPERATION_COPY.resume).toMatchObject({ busy: "再開中…", done: "再開しました" });
  });
});

describe("startsText", () => {
  it("番号を「・」でつなぐ。無ければ null", () => {
    expect(startsText([12])).toBe("#12 が動き出します");
    expect(startsText([15, 14])).toBe("#15・#14 が動き出します");
    expect(startsText([])).toBeNull();
    expect(startsText(undefined)).toBeNull();
  });
});

describe("doneSummary", () => {
  it("マージは PR の番号とリンク、止めていた物を出す", () => {
    const summary = doneSummary("merge", item(73, { blocking: [12] }));
    expect(summary).toEqual({
      title: "マージしました",
      pull: { number: 73, url: "https://github.com/o/r/pull/73" },
      starts: "#12 が動き出します",
    });
  });

  it("Issueに紐づくマージは、Issueではなく PR の番号とURL", () => {
    const p = pull(38);
    const summary = doneSummary(
      "merge",
      item(23, {
        pullOnly: false,
        issue: { number: 23, title: "t", url: "https://github.com/o/r/issues/23" },
        status: { ...pullOnlyStatus(p, { passed: 1, total: 1 }) },
        merge: { pullNumber: 38, base: "main", ci: { passed: 1, total: 1 }, review: "clean" },
      }),
    );
    expect(summary.pull).toEqual({ number: 38, url: "https://github.com/o/r/pull/38" });
    expect(summary.starts).toBeNull();
  });

  it("マージ以外は文言だけ（PR・動き出す物は出さない）", () => {
    expect(doneSummary("resume", item(5, { blocking: [9] }))).toEqual({
      title: "再開しました",
      pull: null,
      starts: null,
    });
  });
});

describe("withHeldRows", () => {
  it("預かりが無ければ、並びはそのまま", () => {
    expect(numbers(withHeldRows([item(1), item(2)], new Map()))).toEqual([1, 2]);
  });

  it("並びにまだある行は、押した時点の中身に置き換える", () => {
    const before = item(2, { description: "押した時点" });
    const rows = withHeldRows([item(1), item(2, { description: "取り直した" }), item(3)], held([{ item: before, index: 1 }]));
    expect(numbers(rows)).toEqual([1, 2, 3]);
    expect(rows[1].description).toBe("押した時点");
  });

  it("取り直しで消えた行は、押した時点の位置に戻す", () => {
    expect(numbers(withHeldRows([item(2), item(3)], held([{ item: item(1), index: 0 }])))).toEqual([1, 2, 3]);
    expect(numbers(withHeldRows([item(1), item(3)], held([{ item: item(2), index: 1 }])))).toEqual([1, 2, 3]);
  });

  it("位置が並びより後ろなら、いちばん後ろに置く", () => {
    expect(numbers(withHeldRows([item(1)], held([{ item: item(9), index: 5 }])))).toEqual([1, 9]);
  });

  it("消えた行が複数でも、押した時点の位置の順に戻す", () => {
    const rows = withHeldRows(
      [item(2), item(4)],
      held([
        { item: item(3), index: 2 },
        { item: item(1), index: 0 },
      ]),
    );
    expect(numbers(rows)).toEqual([1, 2, 3, 4]);
  });
});

describe("heldIndex", () => {
  const rows = [item(1), item(2), item(3), item(4), item(5)];
  const key = (n: number) => turnItemKey(item(n));

  it("初めて預かるときは、並びにある位置", () => {
    expect(heldIndex(undefined, rows, key(4))).toBe(3);
  });

  it("初めて預かるときに並びに無ければ 0", () => {
    expect(heldIndex(undefined, rows, key(9))).toBe(0);
  });

  it("預かり済みなら、取り直した並びから消えていても前の位置のまま（0 にしない）", () => {
    const before: HeldRow<TurnItem> = { item: item(5), index: 4, done: false };
    expect(heldIndex(before, rows.slice(0, 4), key(5))).toBe(4);
  });

  it("done が変わっても位置は同じ", () => {
    const before: HeldRow<TurnItem> = { item: item(3), index: 2, done: false };
    expect(heldIndex(before, rows, key(3))).toBe(2);
    expect(heldIndex({ ...before, done: true }, rows.slice(0, 2), key(3))).toBe(2);
  });
});
