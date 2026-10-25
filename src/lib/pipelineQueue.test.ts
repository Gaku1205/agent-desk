import { describe, expect, it } from "vitest";
import type { CommentData, IssueData, RepoData } from "./github/types";
import { buildPipelineRows, countPipelineWork, getQueueReason } from "./pipeline";

const NOW = new Date("2026-10-25T12:00:00Z");

function issue(number: number, labels: string[] = []): IssueData {
  return {
    number,
    title: `Issue ${number}`,
    body: "",
    state: "open",
    labels,
    url: `https://github.com/o/r/issues/${number}`,
    createdAt: "2026-10-25T09:00:00Z",
    updatedAt: "2026-10-25T09:00:00Z",
    closedAt: null,
  };
}

function data(issues: IssueData[], comments: CommentData[] = []): RepoData {
  return { issues, pulls: [], comments, pullChecks: {}, events: [] };
}

function comment(id: number, issueNumber: number, body: string, author = "claude[bot]"): CommentData {
  return { id, issueNumber, author, body, createdAt: `2026-10-25T10:0${id}:00Z` };
}

const queued = (n: number) => issue(n, ["ai:queue"]);

describe("順番待ちの順番", () => {
  it("ai:queue の行に、番号の小さい順で順番を付ける", () => {
    const rows = buildPipelineRows(data([queued(7), issue(5), queued(3), queued(9)]), NOW);
    const byNumber = Object.fromEntries(rows.map((row) => [row.issue.number, row]));
    expect(byNumber[3].description).toBe("順番待ち 1番目");
    expect(byNumber[7].description).toBe("順番待ち 2番目");
    expect(byNumber[9].description).toBe("順番待ち 3番目");
    expect(byNumber[5].queuePosition).toBeNull();
  });

  it("行の並び順（番号の大きい順）は変えない", () => {
    const rows = buildPipelineRows(data([queued(3), queued(7)]), NOW);
    expect(rows.map((row) => row.issue.number)).toEqual([7, 3]);
  });
});

describe("countPipelineWork", () => {
  it("順番待ちの行と、AI作業中の行を数える", () => {
    const rows = buildPipelineRows(data([queued(1), queued(2), issue(3, ["ai:implement"]), issue(4)]), NOW);
    expect(countPipelineWork(rows)).toEqual({ queued: 2, working: 1 });
  });

  it("何も無ければ0件", () => {
    expect(countPipelineWork([])).toEqual({ queued: 0, working: 0 });
  });
});

describe("getQueueReason", () => {
  it("claude[bot] の最新のコメントを使う。完了コメントと他人のコメントは除く", () => {
    const comments = [
      comment(1, 3, "古い理由"),
      comment(2, 3, "#2 とぶつかるので待ちます"),
      comment(3, 3, "Claude finished the task"),
      comment(4, 3, "人間のコメント", "someone"),
      comment(5, 4, "別のIssue"),
    ];
    expect(getQueueReason(3, comments)).toBe("#2 とぶつかるので待ちます");
  });

  it("コメントが無ければ null", () => {
    expect(getQueueReason(8, [comment(1, 3, "理由")])).toBeNull();
  });

  it("順番待ちの行にだけ理由を持たせる", () => {
    const rows = buildPipelineRows(data([queued(3), issue(4)], [comment(1, 3, "理由"), comment(2, 4, "別")]), NOW);
    expect(rows.find((row) => row.issue.number === 3)?.queueReason).toBe("理由");
    expect(rows.find((row) => row.issue.number === 4)?.queueReason).toBeNull();
  });
});
