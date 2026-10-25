import { describe, expect, it } from "vitest";
import type { CheckRunData, CommentData, IssueData, PullChecks, PullData } from "./github/types";
import {
  bodyClosesIssue,
  ciState,
  DEFAULT_STUCK_REASON,
  deployState,
  findLinkedPull,
  getIssueStatus,
  hasFinishedReviewCheck,
  implementResult,
  isClaudeReviewCheck,
  reviewedWithoutIssues,
  shouldShowIssue,
  stuckReason,
  type StatusInput,
} from "./status";

const NOW = new Date("2026-10-25T12:00:00Z");

function issue(overrides: Partial<IssueData> = {}): IssueData {
  return {
    number: 3,
    title: "状態の判定",
    body: "",
    state: "open",
    labels: [],
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
    title: "状態の判定",
    body: "Closes #3",
    state: "open",
    merged: false,
    labels: [],
    url: "https://github.com/o/r/pull/11",
    headRef: "claude/issue-3-20261025-1509",
    headSha: "head",
    mergeCommitSha: null,
    createdAt: "2026-10-25T10:00:00Z",
    updatedAt: "2026-10-25T10:00:00Z",
    mergedAt: null,
    ...overrides,
  };
}

function mergedPull(mergedAt = "2026-10-25T11:50:00Z", overrides: Partial<PullData> = {}): PullData {
  return pull({ state: "closed", merged: true, mergedAt, mergeCommitSha: "merge", ...overrides });
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

const vercelCheck = check({ name: "Vercel Preview Comments", appSlug: "vercel" });
const ciRunning = check({ status: "in_progress", conclusion: null, completedAt: null });
const ciFailed = check({ conclusion: "failure" });
const reviewDone = check({ name: "review", conclusion: "success" });
const reviewSkipped = check({ name: "review", conclusion: "skipped" });
const reviewRunning = check({ name: "review", status: "in_progress", conclusion: null });

let nextId = 1;
function comment(overrides: Partial<CommentData> = {}): CommentData {
  return {
    id: nextId++,
    issueNumber: 3,
    author: "claude[bot]",
    body: "",
    createdAt: "2026-10-25T10:00:00Z",
    ...overrides,
  };
}

const doneComment = comment({ body: "**Claude finished @Gaku1205's task in 5m**" });
const errorComment = comment({ body: "**Claude encountered an error after 3m**" });
const noIssuesReview = comment({
  issueNumber: 11,
  body: "## Code review\n\nNo issues found. Checked for bugs and CLAUDE.md compliance.",
});
const issuesReview = comment({
  issueNumber: 11,
  body: "## Code review\n\nFound 2 issues:\n\n1. ...",
});

function input(
  pulls: PullData[] = [],
  checks: Record<number, Partial<PullChecks>> = {},
  comments: CommentData[] = [],
): StatusInput {
  const pullChecks: Record<number, PullChecks> = {};
  for (const [number, value] of Object.entries(checks)) {
    pullChecks[Number(number)] = { checkRuns: [], statuses: [], ...value };
  }
  return { pulls, comments, pullChecks };
}

describe("getIssueStatus：表の各段階", () => {
  it("公開済み：公開ステータスが success", () => {
    const status = getIssueStatus(
      issue({ state: "closed" }),
      input([mergedPull()], {
        11: { statuses: [{ context: "Vercel", state: "success", updatedAt: "2026-10-25T11:55:00Z" }] },
      }),
      NOW,
    );
    expect(status.stage).toBe("deployed");
    expect(status.turn).toBe("none");
    expect(status.deployUnknown).toBe(false);
  });

  it("公開済み（状況は不明）：公開ステータスが無いままマージから30分以上", () => {
    const status = getIssueStatus(issue({ state: "closed" }), input([mergedPull("2026-10-25T11:30:00Z")]), NOW);
    expect(status.stage).toBe("deployed");
    expect(status.deployUnknown).toBe(true);
  });

  it("公開中：公開ステータスが pending", () => {
    const status = getIssueStatus(
      issue(),
      input([mergedPull()], {
        11: { statuses: [{ context: "Vercel – agent-desk", state: "pending", updatedAt: "2026-10-25T11:51:00Z" }] },
      }),
      NOW,
    );
    expect(status.stage).toBe("deploying");
    expect(status.turn).toBe("none");
  });

  it("公開中：公開ステータスが無く、マージから30分たっていない", () => {
    const status = getIssueStatus(issue(), input([mergedPull("2026-10-25T11:31:00Z")]), NOW);
    expect(status.stage).toBe("deploying");
    expect(status.deployUnknown).toBe(false);
  });

  it.each(["failure", "error"])("公開失敗：公開ステータスが %s", (state) => {
    const status = getIssueStatus(
      issue(),
      input([mergedPull()], { 11: { statuses: [{ context: "Vercel", state, updatedAt: "2026-10-25T11:55:00Z" }] } }),
      NOW,
    );
    expect(status.stage).toBe("deployFailed");
    expect(status.turn).toBe("human");
  });

  it.each([
    ["チェックが無い", []],
    ["実行中", [reviewRunning]],
    ["skipped のみ", [reviewSkipped]],
  ])("レビュー中：ai:review があり、Claude Reviewが%s", (_, reviewChecks) => {
    const status = getIssueStatus(
      issue(),
      input([pull({ labels: ["ai:review"] })], { 11: { checkRuns: [check(), ...reviewChecks] } }),
      NOW,
    );
    expect(status.stage).toBe("reviewing");
    expect(status.turn).toBe("ai");
  });

  it("ai:review があっても、Claude Reviewが完了していればレビュー中ではない", () => {
    const status = getIssueStatus(
      issue(),
      input([pull({ labels: ["ai:review"] })], { 11: { checkRuns: [check(), reviewDone] } }, [issuesReview]),
      NOW,
    );
    expect(status.stage).toBe("mergeWaiting");
  });

  it("CI中：CIが実行中", () => {
    const status = getIssueStatus(issue(), input([pull()], { 11: { checkRuns: [check(), ciRunning] } }), NOW);
    expect(status.stage).toBe("ciRunning");
    expect(status.turn).toBe("ai");
    expect(status.ci).toEqual({ passed: 1, total: 2 });
  });

  it("CI中：Vercelのチェックだけで、GitHub ActionsのCIチェックが無い", () => {
    const status = getIssueStatus(issue(), input([pull()], { 11: { checkRuns: [vercelCheck] } }), NOW);
    expect(status.stage).toBe("ciRunning");
    expect(status.ci).toEqual({ passed: 1, total: 1 });
  });

  it("CI中：チェックがまだ1つも無い", () => {
    const status = getIssueStatus(issue(), input([pull()]), NOW);
    expect(status.stage).toBe("ciRunning");
    expect(status.ci).toEqual({ passed: 0, total: 0 });
  });

  it("CI失敗：CIのチェックが失敗", () => {
    const status = getIssueStatus(issue(), input([pull()], { 11: { checkRuns: [ciFailed, ciRunning] } }), NOW);
    expect(status.stage).toBe("ciFailed");
    expect(status.turn).toBe("ai");
  });

  it("PR作成待ち：PRはないが、実装AIの完了コメントがある", () => {
    const status = getIssueStatus(issue({ labels: ["ai:implement"] }), input([], {}, [doneComment]), NOW);
    expect(status.stage).toBe("prWaiting");
    expect(status.turn).toBe("human");
    expect(status.implementError).toBe(false);
  });

  it("PR作成待ち（エラーで終了）：最新が実装AIのエラーコメント", () => {
    const status = getIssueStatus(
      issue({ labels: ["ai:implement"] }),
      input([], {}, [doneComment, { ...errorComment, createdAt: "2026-10-25T11:00:00Z" }]),
      NOW,
    );
    expect(status.stage).toBe("prWaiting");
    expect(status.implementError).toBe(true);
  });

  it("AI作業中：ai:implement があり、完了コメントもPRもない", () => {
    const status = getIssueStatus(issue({ labels: ["ai:implement"] }), input(), NOW);
    expect(status.stage).toBe("implementing");
    expect(status.turn).toBe("ai");
  });

  it("企画中：ai:plan がある", () => {
    const status = getIssueStatus(issue({ labels: ["ai:plan"] }), input(), NOW);
    expect(status.stage).toBe("planning");
    expect(status.turn).toBe("ai");
  });

  it("順番待ち：ai:queue がある", () => {
    const status = getIssueStatus(issue({ labels: ["ai:queue"] }), input(), NOW);
    expect(status.stage).toBe("queued");
    expect(status.turn).toBe("none");
  });

  it("未着手：どれでもない", () => {
    const status = getIssueStatus(issue(), input(), NOW);
    expect(status.stage).toBe("notStarted");
    expect(status.turn).toBe("human");
    expect(status.pull).toBeNull();
  });
});

describe("getIssueStatus：マージ待ちの誰の番", () => {
  const passedChecks = { 11: { checkRuns: [check(), vercelCheck, reviewDone] } };

  it("ai:hold がある → 人間", () => {
    const status = getIssueStatus(issue(), input([pull({ labels: ["ai:hold"] })], passedChecks, [noIssuesReview]), NOW);
    expect(status.stage).toBe("mergeWaiting");
    expect(status.mergeWait).toBe("hold");
    expect(status.turn).toBe("human");
    expect(status.ci).toEqual({ passed: 2, total: 2 });
  });

  it("レビューしていない → AI（レビューに回す）", () => {
    const status = getIssueStatus(issue(), input([pull()], { 11: { checkRuns: [check()] } }), NOW);
    expect(status.stage).toBe("mergeWaiting");
    expect(status.mergeWait).toBe("needsReview");
    expect(status.turn).toBe("ai");
  });

  it("指摘あり → AI（直させる）", () => {
    const status = getIssueStatus(issue(), input([pull()], passedChecks, [issuesReview]), NOW);
    expect(status.mergeWait).toBe("needsReview");
    expect(status.turn).toBe("ai");
  });

  it("指摘なし → AI（自動マージ直前）", () => {
    const status = getIssueStatus(issue(), input([pull()], passedChecks, [noIssuesReview]), NOW);
    expect(status.mergeWait).toBe("autoMerge");
    expect(status.turn).toBe("ai");
  });
});

describe("getIssueStatus：止まった", () => {
  it("Issueの ai:stuck はほかの条件より優先され、止まる前の段階も返る", () => {
    const status = getIssueStatus(
      issue({ labels: ["ai:implement", "ai:stuck"] }),
      input([pull({ labels: ["ai:review"] })], { 11: { checkRuns: [check()] } }),
      NOW,
    );
    expect(status.stage).toBe("stuck");
    expect(status.turn).toBe("human");
    expect(status.stageBeforeStuck).toBe("reviewing");
  });

  it("PRの ai:stuck でも止まる。理由はPRの最新の停止コメントから取る", () => {
    const status = getIssueStatus(
      issue(),
      input([pull({ labels: ["ai:stuck"] })], { 11: { checkRuns: [ciFailed] } }, [
        comment({ issueNumber: 11, author: "Gaku1205", body: "⏸ 自動で進めるのを止めました：古い理由\n\n確認して…" }),
        comment({
          issueNumber: 11,
          author: "Gaku1205",
          body: "⏸ 自動で進めるのを止めました：CIの失敗を2回直しても解決しません\n\n確認して…",
          createdAt: "2026-10-25T11:00:00Z",
        }),
      ]),
      NOW,
    );
    expect(status.stage).toBe("stuck");
    expect(status.stageBeforeStuck).toBe("ciFailed");
    expect(status.stuckReason).toBe("CIの失敗を2回直しても解決しません");
  });

  it("停止コメントが無ければ既定の理由", () => {
    const status = getIssueStatus(issue({ labels: ["ai:stuck", "ai:implement"] }), input(), NOW);
    expect(status.stageBeforeStuck).toBe("implementing");
    expect(status.stuckReason).toBe(DEFAULT_STUCK_REASON);
  });

  it("閉じたIssueは ai:stuck があっても止まったにしない", () => {
    const status = getIssueStatus(
      issue({ state: "closed", labels: ["ai:stuck"] }),
      input([mergedPull("2026-10-25T11:00:00Z")]),
      NOW,
    );
    expect(status.stage).toBe("deployed");
    expect(status.stageBeforeStuck).toBeNull();
    expect(status.stuckReason).toBeNull();
  });
});

describe("紐づくPR", () => {
  it.each(["Closes #3", "closes #3", "Fixes #3", "RESOLVED #3", "fix #3", "close: #3"])("本文の「%s」で紐づく", (body) => {
    expect(bodyClosesIssue(body, 3)).toBe(true);
  });

  it("番号が違えば紐づかない", () => {
    expect(bodyClosesIssue("Closes #30", 3)).toBe(false);
    expect(bodyClosesIssue("See #3", 3)).toBe(false);
  });

  it("ブランチ名 claude/issue-<番号>- で紐づく", () => {
    const found = findLinkedPull([pull({ body: "", headRef: "claude/issue-3-x" })], 3);
    expect(found?.number).toBe(11);
    expect(findLinkedPull([pull({ body: "", headRef: "claude/issue-30-x" })], 3)).toBeNull();
  });

  it("openのPRを優先し、マージされずに閉じたPRは使わない", () => {
    const closed = pull({ number: 12, state: "closed", createdAt: "2026-10-25T11:00:00Z" });
    const merged = mergedPull("2026-10-25T10:30:00Z", { number: 13 });
    const open = pull({ number: 14, createdAt: "2026-10-25T09:00:00Z" });
    expect(findLinkedPull([closed, merged, open], 3)?.number).toBe(14);
    expect(findLinkedPull([closed, merged], 3)?.number).toBe(13);
    expect(findLinkedPull([closed], 3)).toBeNull();
  });
});

describe("shouldShowIssue", () => {
  it("openのIssueは表示する", () => {
    expect(shouldShowIssue(issue(), [])).toBe(true);
  });

  it("閉じたIssueは紐づくPRがマージ済みのときだけ表示する", () => {
    const closed = issue({ state: "closed" });
    expect(shouldShowIssue(closed, [mergedPull()])).toBe(true);
    expect(shouldShowIssue(closed, [pull({ state: "closed" })])).toBe(false);
    expect(shouldShowIssue(closed, [mergedPull(undefined, { body: "", headRef: "claude/issue-4-x" })])).toBe(false);
  });
});

describe("実装AIのコメント", () => {
  it("claude[bot] の完了コメントとエラーコメントを見分ける", () => {
    expect(implementResult([doneComment], 3)).toBe("done");
    expect(implementResult([errorComment], 3)).toBe("error");
    expect(implementResult([], 3)).toBeNull();
  });

  it("claude[bot] 以外や、ほかのIssueのコメントは見ない", () => {
    expect(implementResult([{ ...doneComment, author: "Gaku1205" }], 3)).toBeNull();
    expect(implementResult([{ ...doneComment, issueNumber: 4 }], 3)).toBeNull();
  });
});

describe("Claude Reviewのチェック", () => {
  it("GitHub Actionsの review ジョブを見分ける", () => {
    expect(isClaudeReviewCheck(reviewDone)).toBe(true);
    expect(isClaudeReviewCheck(check())).toBe(false);
    expect(isClaudeReviewCheck({ ...reviewDone, appSlug: "vercel" })).toBe(false);
  });

  it("skipped 以外の結果で完了したものだけ「終わった」", () => {
    expect(hasFinishedReviewCheck([reviewDone])).toBe(true);
    expect(hasFinishedReviewCheck([check({ name: "review", conclusion: "failure" })])).toBe(true);
    expect(hasFinishedReviewCheck([reviewSkipped, reviewRunning])).toBe(false);
  });
});

describe("ciState", () => {
  it("Claude Reviewは数に入れず、Vercelは数に入れる", () => {
    expect(ciState([check(), vercelCheck, reviewRunning])).toEqual({ state: "passed", passed: 2, total: 2 });
  });

  it("Vercelのチェックだけなら実行中", () => {
    expect(ciState([vercelCheck]).state).toBe("running");
  });

  it("失敗があれば失敗", () => {
    expect(ciState([check(), check({ conclusion: "timed_out" })]).state).toBe("failed");
  });
});

describe("reviewedWithoutIssues", () => {
  it("最新の「## Code review」コメントに No issues found があるか", () => {
    expect(reviewedWithoutIssues([noIssuesReview], 11)).toBe(true);
    expect(reviewedWithoutIssues([noIssuesReview, { ...issuesReview, createdAt: "2026-10-25T11:00:00Z" }], 11)).toBe(false);
    expect(reviewedWithoutIssues([issuesReview, { ...noIssuesReview, createdAt: "2026-10-25T11:00:00Z" }], 11)).toBe(true);
    expect(reviewedWithoutIssues([], 11)).toBe(false);
  });

  it("claude[bot] 以外のコメントは見ない", () => {
    expect(reviewedWithoutIssues([{ ...noIssuesReview, author: "Gaku1205" }], 11)).toBe(false);
  });
});

describe("stuckReason", () => {
  it("PRが無ければ null", () => {
    expect(stuckReason([], null)).toBeNull();
  });
});

describe("deployState", () => {
  it("Vercel で始まらないステータスは見ない", () => {
    const statuses = [{ context: "ci/other", state: "success", updatedAt: "2026-10-25T11:55:00Z" }];
    expect(deployState(statuses, "2026-10-25T11:50:00Z", NOW)).toEqual({ state: "deploying", unknown: false });
  });

  it("ちょうど30分で公開済み（状況は不明）", () => {
    expect(deployState([], "2026-10-25T11:30:00Z", NOW)).toEqual({ state: "deployed", unknown: true });
  });

  it("いちばん新しいVercelのステータスを使う", () => {
    const statuses = [
      { context: "Vercel", state: "success", updatedAt: "2026-10-25T11:58:00Z" },
      { context: "Vercel", state: "pending", updatedAt: "2026-10-25T11:51:00Z" },
    ];
    expect(deployState(statuses, "2026-10-25T11:50:00Z", NOW).state).toBe("deployed");
  });
});
