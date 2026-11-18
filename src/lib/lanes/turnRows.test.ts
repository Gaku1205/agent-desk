import { describe, expect, it } from "vitest";
import type { PullData } from "../github/types";
import { pullOnlyStatus, type TurnItem } from "../turn";
import { answerLinkLabel, lanesTurnRows, needsAnswerForm } from "./turnRows";

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

function mergeItem(number: number, waitingSince: string, over: Partial<TurnItem> = {}): TurnItem {
  const p = pull(number);
  return {
    owner: "o",
    repo: "r",
    issue: { number, title: p.title, url: p.url },
    status: pullOnlyStatus(p, { passed: 4, total: 4 }),
    description: "",
    note: null,
    logUrl: null,
    waitingSince,
    buttons: [{ type: "operation", kind: "merge", label: "マージ…" }],
    merge: { pullNumber: number, base: "main", ci: { passed: 4, total: 4 }, review: "clean" },
    question: null,
    factory: null,
    pullOnly: true,
    ...over,
  };
}

function otherItem(number: number, stage: "question" | "factoryTalk" | "stuck", waitingSince: string): TurnItem {
  const base = mergeItem(number, waitingSince);
  return {
    ...base,
    pullOnly: false,
    merge: null,
    buttons: [],
    status: { ...base.status, stage },
  };
}

const numbers = (items: TurnItem[]) => items.map((i) => i.issue.number);

describe("lanesTurnRows", () => {
  it("今の「あなたの番」と同じ並び（強い色が先、待ちが長い順）", () => {
    const rows = lanesTurnRows([
      mergeItem(1, "2026-11-18T01:00:00Z", { merge: null, buttons: [] }),
      otherItem(2, "question", "2026-11-18T02:00:00Z"),
      otherItem(3, "stuck", "2026-11-18T03:00:00Z"),
    ]);
    expect(numbers(rows)).toEqual([3, 1, 2]);
  });

  it("マージ待ちが1件なら、並びを変えない", () => {
    const rows = lanesTurnRows([mergeItem(10, "2026-11-18T01:00:00Z"), otherItem(2, "question", "2026-11-18T00:00:00Z")]);
    expect(numbers(rows)).toEqual([2, 10]);
  });

  it("マージ待ちが2件以上なら、マージ待ちの行だけすすめる順にする（ほかの行の位置は変えない）", () => {
    const rows = lanesTurnRows([
      mergeItem(30, "2026-11-18T01:00:00Z"),
      otherItem(2, "question", "2026-11-18T02:00:00Z"),
      mergeItem(20, "2026-11-18T03:00:00Z", { blocking: [5] }),
      mergeItem(10, "2026-11-18T04:00:00Z"),
    ]);
    // 並び：20（止めている）→ 30 → 2 → 10。マージ待ちの位置に、すすめる順（20 → 10 → 30）を入れる
    expect(numbers(rows)).toEqual([20, 10, 2, 30]);
  });

  it("元の配列を変えない", () => {
    const input = [mergeItem(2, "2026-11-18T02:00:00Z"), mergeItem(1, "2026-11-18T01:00:00Z")];
    lanesTurnRows(input);
    expect(numbers(input)).toEqual([2, 1]);
  });
});

describe("答える欄が要る物", () => {
  it("質問と工場の相談だけ", () => {
    expect(needsAnswerForm(otherItem(1, "question", "x"))).toBe(true);
    expect(needsAnswerForm(otherItem(1, "factoryTalk", "x"))).toBe(true);
    expect(needsAnswerForm(otherItem(1, "stuck", "x"))).toBe(false);
  });

  it("リンクの文字", () => {
    expect(answerLinkLabel(otherItem(1, "question", "x"))).toBe("答える");
    expect(answerLinkLabel(otherItem(1, "factoryTalk", "x"))).toBe("相談に答える");
  });
});
