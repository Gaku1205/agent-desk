import { describe, expect, it } from "vitest";
import type { CheckRunData, CommentData, IssueData, PullData } from "./github/types";
import { isMergeablePull, isUnlinkedMergeablePull, unlinkedMergeablePulls } from "./mergeablePull";
import { getIssueStatus } from "./status";
import { repoTurnItems, turnItemKey } from "./turn";

const NOW = new Date("2026-11-17T12:00:00Z");
const T = "2026-11-17T10:00:00Z";

function pull(over: Partial<PullData> = {}): PullData {
  return {
    number: 50,
    title: "READMEを直す",
    body: "手作業のPR",
    state: "open",
    merged: false,
    labels: ["ai:hold"],
    url: "https://example.com/pull/50",
    headRef: "manager/readme",
    headSha: "abc",
    mergeCommitSha: null,
    createdAt: T,
    updatedAt: T,
    mergedAt: null,
    ...over,
  };
}

function issue(over: Partial<IssueData> = {}): IssueData {
  return {
    number: 7,
    title: "機能",
    body: "",
    state: "open",
    labels: ["ai:stuck"],
    url: "https://example.com/issues/7",
    createdAt: T,
    updatedAt: T,
    closedAt: null,
    ...over,
  };
}

const passed: CheckRunData[] = [
  { name: "test", status: "completed", conclusion: "success", appSlug: "github-actions", completedAt: T },
];
const failed: CheckRunData[] = [{ ...passed[0], conclusion: "failure" }];
const running: CheckRunData[] = [{ ...passed[0], status: "in_progress", conclusion: null, completedAt: null }];

function review(pullNumber: number, body = "## Code review\n\nNo issues found."): CommentData {
  return { id: 1, issueNumber: pullNumber, author: "claude[bot]", body, createdAt: T };
}

describe("isMergeablePull", () => {
  const clean = [review(50)];
  it("hold・指摘なし・CI通過のopen PRは true", () => {
    expect(isMergeablePull(pull(), clean, { checkRuns: passed, statuses: [] })).toBe(true);
  });
  it("hold が無い・レビュー未完了・指摘あり・CI実行中や失敗・open でないときは false", () => {
    const checks = { checkRuns: passed, statuses: [] };
    expect(isMergeablePull(pull({ labels: [] }), clean, checks)).toBe(false);
    expect(isMergeablePull(pull(), [], checks)).toBe(false);
    expect(isMergeablePull(pull(), [review(50, "## Code review\n\n指摘あり")], checks)).toBe(false);
    expect(isMergeablePull(pull(), clean, { checkRuns: running, statuses: [] })).toBe(false);
    expect(isMergeablePull(pull(), clean, { checkRuns: failed, statuses: [] })).toBe(false);
    expect(isMergeablePull(pull(), clean, undefined)).toBe(false);
    expect(isMergeablePull(pull({ state: "closed" }), clean, checks)).toBe(false);
  });
});

describe("Issueに紐づかない PR", () => {
  const checks = { 50: { checkRuns: passed, statuses: [] }, 51: { checkRuns: passed, statuses: [] } };
  it("Closes やブランチで紐づく PR は含めない", () => {
    expect(isUnlinkedMergeablePull(pull({ body: "Closes #7" }), [review(50)], checks[50])).toBe(false);
    expect(isUnlinkedMergeablePull(pull({ headRef: "claude/issue-7-x" }), [review(50)], checks[50])).toBe(false);
    expect(unlinkedMergeablePulls([pull()], [review(50)], checks)).toHaveLength(1);
  });

  it("「あなたの番」にマージとして出る。キーは番号で、Issue とは重ならない", () => {
    const items = repoTurnItems(
      "o",
      "r",
      { issues: [issue({ labels: [] })], pulls: [pull()], comments: [review(50)], pullChecks: checks, events: [] },
      NOW,
    );
    const lone = items.find((item) => item.pullOnly);
    expect(lone?.issue).toEqual({ number: 50, title: "READMEを直す", url: "https://example.com/pull/50" });
    expect(lone?.buttons).toEqual([{ type: "operation", kind: "merge", label: "マージ…" }]);
    expect(lone?.merge?.pullNumber).toBe(50);
    expect(turnItemKey(lone!)).toBe("o/r#50");
  });

  it("条件を満たさない PR は出ない", () => {
    const items = repoTurnItems(
      "o",
      "r",
      { issues: [], pulls: [pull({ labels: [] })], comments: [review(50)], pullChecks: checks, events: [] },
      NOW,
    );
    expect(items).toHaveLength(0);
  });
});

describe("止まった Issue より、マージしてよい PR を優先する", () => {
  const linked = pull({ number: 60, body: "Closes #7", headRef: "claude/issue-7-x" });
  const base = (pulls: PullData[], comments: CommentData[], runs: CheckRunData[]) => ({
    pulls,
    comments,
    pullChecks: { 60: { checkRuns: runs, statuses: [] } },
  });

  it("PR がマージしてよい状態なら マージ待ち（hold）", () => {
    const status = getIssueStatus(issue(), base([linked], [review(60)], passed), NOW);
    expect(status.stage).toBe("mergeWaiting");
    expect(status.mergeWait).toBe("hold");
    expect(status.turn).toBe("human");
  });

  it("PR がその状態でなければ今までどおり止まった", () => {
    expect(getIssueStatus(issue(), base([linked], [review(60)], failed), NOW).stage).toBe("stuck");
    expect(getIssueStatus(issue(), base([linked], [], passed), NOW).stage).toBe("stuck");
    expect(getIssueStatus(issue(), base([], [], []), NOW).stage).toBe("stuck");
  });
});
