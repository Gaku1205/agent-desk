import { describe, expect, it } from "vitest";
import type {
  CheckRunData,
  CommentData,
  IssueData,
  PullData,
  RepoData,
  RepoResult,
} from "./github/types";
import { getIssueStatus } from "./status";
import {
  buildTurnItems,
  countTurnItems,
  filterTurnItems,
  formatWait,
  isOperationAvailable,
  turnButtons,
  waitingSince,
  type TurnButton,
} from "./turn";

const NOW = new Date("2026-10-25T12:00:00Z");

function issue(number: number, overrides: Partial<IssueData> = {}): IssueData {
  return {
    number,
    title: `Issue ${number}`,
    body: "",
    state: "open",
    labels: [],
    url: `https://github.com/o/r/issues/${number}`,
    createdAt: "2026-10-25T09:00:00Z",
    updatedAt: "2026-10-25T09:00:00Z",
    closedAt: null,
    ...overrides,
  };
}

function pull(number: number, issueNumber: number, overrides: Partial<PullData> = {}): PullData {
  return {
    number,
    title: `PR ${number}`,
    body: `Closes #${issueNumber}`,
    state: "open",
    merged: false,
    labels: [],
    url: `https://github.com/o/r/pull/${number}`,
    headRef: `claude/issue-${issueNumber}-20261025-1000`,
    headSha: `sha${number}`,
    mergeCommitSha: null,
    createdAt: "2026-10-25T10:00:00Z",
    updatedAt: "2026-10-25T10:00:00Z",
    mergedAt: null,
    ...overrides,
  };
}

function check(overrides: Partial<CheckRunData> = {}): CheckRunData {
  return {
    name: "check",
    status: "completed",
    conclusion: "success",
    appSlug: "github-actions",
    completedAt: "2026-10-25T10:10:00Z",
    ...overrides,
  };
}

let nextId = 1;
function comment(issueNumber: number, body: string, overrides: Partial<CommentData> = {}): CommentData {
  return {
    id: nextId++,
    issueNumber,
    author: "claude[bot]",
    body,
    createdAt: "2026-10-25T10:00:00Z",
    ...overrides,
  };
}

function data(overrides: Partial<RepoData> = {}): RepoData {
  return { issues: [], pulls: [], comments: [], pullChecks: {}, events: [], ...overrides };
}

function ok(owner: string, repo: string, repoData: RepoData): RepoResult {
  return { owner, repo, ok: true, data: repoData };
}

/** 段階ごとのIssueを1つずつ持つリポジトリ */
function mixedRepo(): RepoData {
  return data({
    issues: [
      // 未着手（人間）：作ったのが 9:00
      issue(1, { createdAt: "2026-10-25T09:00:00Z" }),
      // AI作業中（AI）
      issue(2, { labels: ["ai:implement"] }),
      // PR作成待ち（人間）：完了コメント 11:00
      issue(3),
      // 止まった（人間）：ai:stuck が付いたのが 11:30
      issue(4, { labels: ["ai:stuck"] }),
      // マージ待ち・ai:hold（人間）：CIが通ったのが 10:20
      issue(5),
      // 順番待ち（誰でもない）
      issue(6, { labels: ["ai:queue"] }),
      // 閉じたIssue（マージ済みでない）は出さない
      issue(7, { state: "closed" }),
    ],
    pulls: [pull(15, 5, { labels: ["ai:hold"] })],
    pullChecks: {
      15: { checkRuns: [check({ completedAt: "2026-10-25T10:20:00Z" })], statuses: [] },
    },
    comments: [comment(3, "**Claude finished @x's task**", { createdAt: "2026-10-25T11:00:00Z" })],
    events: [
      { event: "labeled", labelName: "ai:stuck", issueNumber: 4, createdAt: "2026-10-25T11:30:00Z" },
    ],
  });
}

describe("保留", () => {
  it("あなたの番に出て、ボタンは「始める」。待ち時間は ai:skip が付いた時刻から", () => {
    const repoData = data({
      issues: [issue(1, { labels: ["ai:skip"] })],
      events: [
        { event: "labeled", labelName: "ai:skip", issueNumber: 1, createdAt: "2026-10-25T09:00:00Z" },
      ],
    });
    const items = buildTurnItems([ok("o", "r", repoData)], NOW);
    expect(items).toHaveLength(1);
    expect(items[0].status.stage).toBe("skipped");
    expect(items[0].buttons).toEqual([{ type: "operation", kind: "start", label: "始める" }]);
    expect(items[0].waitingSince).toBe("2026-10-25T09:00:00Z");
  });
});

describe("buildTurnItems", () => {
  it("人間の番だけを、止まった物を上に、あとは待ちが長い順に並べる", () => {
    const items = buildTurnItems([ok("o", "r", mixedRepo())], NOW);
    expect(items.map((item) => item.issue.number)).toEqual([4, 1, 5, 3]);
    expect(items.map((item) => item.status.stage)).toEqual([
      "stuck",
      "notStarted",
      "mergeWaiting",
      "prWaiting",
    ]);
  });

  it("止まった物が複数あれば、その中でも待ちが長い順", () => {
    const repoData = data({
      issues: [issue(1, { labels: ["ai:stuck"] }), issue(2, { labels: ["ai:stuck"] }), issue(3)],
      events: [
        { event: "labeled", labelName: "ai:stuck", issueNumber: 1, createdAt: "2026-10-25T11:00:00Z" },
        { event: "labeled", labelName: "ai:stuck", issueNumber: 2, createdAt: "2026-10-25T10:00:00Z" },
      ],
    });
    const items = buildTurnItems([ok("o", "r", repoData)], NOW);
    expect(items.map((item) => item.issue.number)).toEqual([2, 1, 3]);
  });

  it("複数のリポジトリをまとめて並べ、取れなかったリポジトリは飛ばす", () => {
    const a = data({ issues: [issue(1, { createdAt: "2026-10-25T08:00:00Z" })] });
    const b = data({ issues: [issue(1, { createdAt: "2026-10-25T07:00:00Z" })] });
    const failed: RepoResult = {
      owner: "o",
      repo: "broken",
      ok: false,
      error: { kind: "other", message: "x" },
    };
    const items = buildTurnItems([ok("o", "a", a), failed, ok("o", "b", b)], NOW);
    expect(items.map((item) => `${item.repo}#${item.issue.number}`)).toEqual(["b#1", "a#1"]);
  });

  it("説明文と、マージの確認ダイアログの中身を持つ", () => {
    const items = buildTurnItems([ok("o", "r", mixedRepo())], NOW);
    const merge = items.find((item) => item.issue.number === 5);
    expect(merge?.description).toBe("CI 1/1 通過・マージできます");
    expect(merge?.merge).toEqual({
      pullNumber: 15,
      base: "main",
      ci: { passed: 1, total: 1 },
      review: null,
    });
    expect(items.find((item) => item.issue.number === 1)?.merge).toBeNull();
  });
});

describe("件数", () => {
  const items = buildTurnItems(
    [
      ok("o", "r", mixedRepo()),
      ok("o", "other", data({ issues: [issue(1)] })),
      ok("o", "empty", data({ issues: [issue(1, { labels: ["ai:plan"] })] })),
    ],
    NOW,
  );

  it("サイドバーの件数は、各ページの「あなたの番」の件数と一致する", () => {
    const counts = countTurnItems(items);
    expect(counts.total).toBe(items.length);
    expect(counts.total).toBe(5);
    for (const repo of ["r", "other", "empty"]) {
      const page = filterTurnItems(items, "o", repo);
      expect(counts.byRepo[`o/${repo}`] ?? 0).toBe(page.length);
    }
    expect(counts.byRepo["o/r"]).toBe(4);
    expect(counts.byRepo["o/empty"]).toBeUndefined();
  });

  it("リポジトリ名の大文字小文字は区別しない", () => {
    expect(filterTurnItems(items, "O", "R")).toHaveLength(4);
  });
});

describe("turnButtons", () => {
  function buttonsFor(target: IssueData, repoData: RepoData): string[] {
    const status = getIssueStatus(target, repoData, NOW);
    return turnButtons(status, repoData).map((button: TurnButton) => button.label);
  }

  it("未着手は「おまかせ」と「実装を依頼」", () => {
    const repoData = data({ issues: [issue(1)] });
    expect(buttonsFor(issue(1), repoData)).toEqual(["おまかせ", "実装を依頼"]);
  });

  it("止まったは「再開」", () => {
    expect(buttonsFor(issue(1, { labels: ["ai:stuck"] }), data())).toEqual(["再開"]);
  });

  it("PR作成待ちは「PRを作る」（エラーで止まったときも）", () => {
    const done = data({ comments: [comment(1, "Claude finished")] });
    expect(buttonsFor(issue(1), done)).toEqual(["PRを作る"]);
    const error = data({ comments: [comment(1, "Claude encountered an error")] });
    expect(buttonsFor(issue(1), error)).toEqual(["PRを作る"]);
  });

  it("マージ待ち・ai:hold で、まだレビューしていなければ「レビューを依頼」と「マージ…」", () => {
    const repoData = data({
      pulls: [pull(10, 1, { labels: ["ai:hold"] })],
      pullChecks: { 10: { checkRuns: [check()], statuses: [] } },
    });
    expect(buttonsFor(issue(1), repoData)).toEqual(["レビューを依頼", "マージ…"]);
  });

  it("マージ待ち・ai:hold で、レビュー済みなら「マージ…」だけ", () => {
    const repoData = data({
      pulls: [pull(10, 1, { labels: ["ai:hold"] })],
      pullChecks: { 10: { checkRuns: [check()], statuses: [] } },
      comments: [comment(10, "## Code review\n\nNo issues found.")],
    });
    expect(buttonsFor(issue(1), repoData)).toEqual(["マージ…"]);
  });

  it("AIの番のマージ待ち（自動でマージする直前など）にはボタンを出さない", () => {
    const repoData = data({
      pulls: [pull(10, 1)],
      pullChecks: { 10: { checkRuns: [check()], statuses: [] } },
    });
    expect(buttonsFor(issue(1), repoData)).toEqual([]);
  });

  it("公開失敗は、PRを開く「確認する」", () => {
    const repoData = data({
      pulls: [pull(10, 1, { state: "closed", merged: true, mergedAt: "2026-10-25T11:00:00Z" })],
      pullChecks: {
        10: {
          checkRuns: [],
          statuses: [{ context: "Vercel", state: "failure", description: "", updatedAt: "2026-10-25T11:05:00Z" }],
        },
      },
    });
    const status = getIssueStatus(issue(1), repoData, NOW);
    expect(turnButtons(status, repoData)).toEqual([
      { type: "link", label: "確認する", href: "https://github.com/o/r/pull/10" },
    ]);
  });

  it("AIの番の段階には出さない", () => {
    expect(buttonsFor(issue(1, { labels: ["ai:implement"] }), data())).toEqual([]);
    expect(buttonsFor(issue(1, { labels: ["ai:plan"] }), data())).toEqual([]);
  });
});

describe("isOperationAvailable", () => {
  it("今の段階のボタンにある操作だけ受け付ける", () => {
    const repoData = data({ issues: [issue(1)] });
    const status = getIssueStatus(issue(1), repoData, NOW);
    expect(isOperationAvailable("plan", status, repoData)).toBe(true);
    expect(isOperationAvailable("merge", status, repoData)).toBe(false);
  });
});

describe("waitingSince", () => {
  it("段階に合わない時刻が無ければ、Issueの更新時刻を使う", () => {
    const target = issue(1, { labels: ["ai:stuck"], updatedAt: "2026-10-25T08:30:00Z" });
    const repoData = data({ issues: [target] });
    expect(waitingSince(target, getIssueStatus(target, repoData, NOW), repoData)).toBe(
      "2026-10-25T08:30:00Z",
    );
  });

  it("止まったときは、PRに ai:stuck が付いた時刻も見る", () => {
    const target = issue(1);
    const repoData = data({
      issues: [target],
      pulls: [pull(10, 1, { labels: ["ai:stuck"] })],
      pullChecks: { 10: { checkRuns: [], statuses: [] } },
      events: [
        { event: "labeled", labelName: "ai:stuck", issueNumber: 10, createdAt: "2026-10-25T10:40:00Z" },
        { event: "labeled", labelName: "ai:review", issueNumber: 10, createdAt: "2026-10-25T10:50:00Z" },
      ],
    });
    expect(waitingSince(target, getIssueStatus(target, repoData, NOW), repoData)).toBe(
      "2026-10-25T10:40:00Z",
    );
  });
});

describe("formatWait", () => {
  it.each([
    ["2026-10-25T11:59:40Z", "1分"],
    ["2026-10-25T11:15:00Z", "45分"],
    ["2026-10-25T09:00:00Z", "3時間"],
    ["2026-10-23T11:00:00Z", "2日"],
  ])("%s から → %s", (since, expected) => {
    expect(formatWait(since, NOW)).toBe(expected);
  });
});
