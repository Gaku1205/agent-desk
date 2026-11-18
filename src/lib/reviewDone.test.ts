import { describe, expect, it } from "vitest";
import type { CheckRunData, CommentData, CommitStatusData } from "./github/types";
import { isAiReviewDone } from "./reviewDone";
import { turnButtons } from "./turn";
import type { IssueStatus } from "./status";

function st(state: string): CommitStatusData {
  return { context: "AIレビュー", state, description: "", updatedAt: "2026-11-18T00:00:00Z" };
}
const reviewCheck = (conclusion: string | null): CheckRunData => ({
  name: "review",
  status: conclusion ? "completed" : "in_progress",
  conclusion,
  appSlug: "github-actions",
  completedAt: null,
});
const reviewComment: CommentData = {
  id: 1,
  issueNumber: 10,
  author: "claude[bot]",
  body: "## Code review\n\nNo issues found.",
  createdAt: "2026-11-18T00:00:00Z",
};

describe("isAiReviewDone", () => {
  it.each([
    ["success", true],
    ["pending", false],
    ["failure", false],
  ])("ステータス AIレビュー が %s → %s", (state, expected) => {
    expect(isAiReviewDone([], 10, { checkRuns: [], statuses: [st(state)] })).toBe(expected);
  });

  it("ステータスが無ければ未レビュー", () => {
    expect(isAiReviewDone([], 10, { checkRuns: [], statuses: [] })).toBe(false);
  });

  it("レビューの check が success なら済み、失敗・実行中なら未レビュー", () => {
    expect(isAiReviewDone([], 10, { checkRuns: [reviewCheck("success")], statuses: [] })).toBe(true);
    expect(isAiReviewDone([], 10, { checkRuns: [reviewCheck("failure")], statuses: [] })).toBe(false);
    expect(isAiReviewDone([], 10, { checkRuns: [reviewCheck(null)], statuses: [] })).toBe(false);
  });

  it("コメントがあれば済み。ステータスが取れていなくてもコメントで決める", () => {
    expect(isAiReviewDone([reviewComment], 10)).toBe(true);
    expect(isAiReviewDone([], 10)).toBe(false);
  });
});

describe("レビューを依頼の出し分け（ai:hold のマージ待ち）", () => {
  const pull = { number: 10, url: "u", labels: ["ai:hold"] } as unknown as IssueStatus["pull"];
  const status = { stage: "mergeWaiting", mergeWait: "hold", pull } as unknown as IssueStatus;
  const labels = (statuses: CommitStatusData[]) =>
    turnButtons(status, {
      comments: [],
      pipeline: "ok" as never,
      pullChecks: { 10: { checkRuns: [], statuses } },
    }).map((b) => b.label);

  it("AIレビュー success は「マージ…」だけ", () => {
    expect(labels([st("success")])).toEqual(["マージ…"]);
  });
  it.each([["pending"], ["failure"]])("%s は今までどおり", (state) => {
    expect(labels([st(state)])).toEqual(["レビューを依頼", "マージ…"]);
  });
  it("無しは今までどおり", () => {
    expect(labels([])).toEqual(["レビューを依頼", "マージ…"]);
  });
});
