import { describe, expect, it } from "vitest";
import type { IssueData, PullData, RepoData } from "./github/types";
import { findUnreadableWork } from "./unreadableWork";

const NOW = new Date("2026-10-25T12:00:00Z");

function issue(overrides: Partial<IssueData> = {}): IssueData {
  return {
    number: 3,
    title: "作業",
    body: "",
    state: "open",
    labels: ["ai:implement"],
    url: "https://github.com/o/r/issues/3",
    createdAt: "2026-10-25T09:00:00Z",
    updatedAt: "2026-10-25T09:00:00Z",
    closedAt: null,
    ...overrides,
  };
}

function pull(overrides: Partial<PullData> = {}): PullData {
  return {
    number: 11,
    title: "作業",
    body: "Closes #3",
    state: "open",
    merged: false,
    labels: [],
    url: "https://github.com/o/r/pull/11",
    headRef: "claude/issue-3-20261025-1509",
    headSha: "c0ffee",
    mergeCommitSha: null,
    createdAt: "2026-10-25T10:00:00Z",
    updatedAt: "2026-10-25T10:00:00Z",
    mergedAt: null,
    ...overrides,
  };
}

function data(issues: IssueData[], pulls: PullData[]): RepoData {
  return { issues, pulls, comments: [], pullChecks: {}, events: [] } as unknown as RepoData;
}

describe("findUnreadableWork", () => {
  it("Issue も PR も行に出ていれば何も返さない", () => {
    expect(findUnreadableWork("o", "r", data([issue()], [pull()]), NOW)).toEqual([]);
  });

  it("Issue が取れていないのに claude/ の PR がある：PR を「状態が読めない」で返す", () => {
    expect(findUnreadableWork("o", "r", data([], [pull()]), NOW)).toEqual([
      { repo: "o/r", number: 11, message: "PR #11 状態が読めない" },
    ]);
  });

  it("claude/ でない PR・閉じた PR は返さない", () => {
    const human = pull({ headRef: "feature/x", body: "" });
    const closed = pull({ number: 12, state: "closed" });
    expect(findUnreadableWork("o", "r", data([], [human, closed]), NOW)).toEqual([]);
  });

  it("保守の Issue（ai:skip＋本文の頭の印）は、隠すのが正しいので返さない", () => {
    const maintenance = issue({ labels: ["ai:skip"], body: "<!-- pipeline-maintenance -->\nx" });
    expect(findUnreadableWork("o", "r", data([maintenance], []), NOW)).toEqual([]);
  });
});
