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
  hasNoDeploys,
  implementResult,
  isClaudeReviewCheck,
  latestSuccessDeployAt,
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
    headSha: "c0ffee",
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
        11: { statuses: [{ context: "Vercel", state: "success", description: "", updatedAt: "2026-10-25T11:55:00Z" }] },
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
        11: { statuses: [{ context: "Vercel – agent-desk", state: "pending", description: "", updatedAt: "2026-10-25T11:51:00Z" }] },
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
      input([mergedPull()], { 11: { statuses: [{ context: "Vercel", state, description: "", updatedAt: "2026-10-25T11:55:00Z" }] } }),
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

  it("保留：ai:skip がある（人間の番）", () => {
    const status = getIssueStatus(issue({ labels: ["ai:skip"] }), input(), NOW);
    expect(status.stage).toBe("skipped");
    expect(status.turn).toBe("human");
  });

  it("保留：ai:plan・ai:implement が付いていれば、そちらが先", () => {
    expect(getIssueStatus(issue({ labels: ["ai:skip", "ai:plan"] }), input(), NOW).stage).toBe("planning");
    expect(getIssueStatus(issue({ labels: ["ai:skip", "ai:implement"] }), input(), NOW).stage).toBe(
      "implementing",
    );
  });

  it("保留：ai:queue より下", () => {
    expect(getIssueStatus(issue({ labels: ["ai:skip", "ai:queue"] }), input(), NOW).stage).toBe("queued");
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

  it("PRなしで止まったIssueは、清書AIのお願いのコメントの理由を使う", () => {
    const status = getIssueStatus(
      issue({ labels: ["ai:stuck"] }),
      input([], {}, [comment({ body: "<!-- human-request -->\n`zod` を足してください。\n\n詳細" })]),
      NOW,
    );
    expect(status.stuckReason).toBe("`zod` を足してください。");
  });

  it("お願いのコメントとPRの停止コメントは、新しい方の理由を使う", () => {
    const pullStuck = (createdAt: string) =>
      comment({
        issueNumber: 11,
        author: "Gaku1205",
        body: "⏸ 自動で進めるのを止めました：PRの理由",
        createdAt,
      });
    const request = comment({
      body: "<!-- human-request -->\nお願いの理由",
      createdAt: "2026-10-25T10:30:00Z",
    });
    const run = (stuckAt: string) =>
      getIssueStatus(
        issue(),
        input([pull({ labels: ["ai:stuck"] })], { 11: { checkRuns: [ciFailed] } }, [
          request,
          pullStuck(stuckAt),
        ]),
        NOW,
      ).stuckReason;
    expect(run("2026-10-25T11:00:00Z")).toBe("PRの理由");
    expect(run("2026-10-25T10:00:00Z")).toBe("お願いの理由");
  });

  it("claude[bot] 以外のコメントの印は使わない", () => {
    const status = getIssueStatus(
      issue({ labels: ["ai:stuck"] }),
      input([], {}, [comment({ author: "Gaku1205", body: "<!-- human-request -->\n偽物" })]),
      NOW,
    );
    expect(status.stuckReason).toBe(DEFAULT_STUCK_REASON);
  });

  it("ai:hold のマージ待ちは、PRの説明のお願いを持つ", () => {
    const body = "Closes #3\n\n## 人間にお願いしたいこと\n- a\n- b\n- c";
    const status = getIssueStatus(
      issue(),
      input([pull({ labels: ["ai:hold"], body })], { 11: { checkRuns: [check()] } }),
      NOW,
    );
    expect(status.mergeWait).toBe("hold");
    expect(status.holdRequest).toBe("マージの前に：a（ほか2件）");
    const none = getIssueStatus(
      issue(),
      input([pull({ labels: ["ai:hold"], body: "Closes #3\n\n## 人間にお願いしたいこと\nなし" })], {
        11: { checkRuns: [check()] },
      }),
      NOW,
    );
    expect(none.holdRequest).toBeNull();
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

describe("getIssueStatus：やり直し待ち", () => {
  const retryComment = (overrides: Partial<CommentData> = {}) =>
    comment({
      author: "Gaku1205",
      body: "🔁 AIが止まったので、時間をおいて自動でやり直します（やり直し 3/10回）。\n理由：使用量の上限に達しました\n\n<!-- auto-retry -->\n<!-- count=3 kind=implement -->",
      ...overrides,
    });

  it("Issueの ai:retry は進行中の段階より優先され、元の段階も返る。人間の番ではない", () => {
    const status = getIssueStatus(
      issue({ labels: ["ai:implement", "ai:retry"] }),
      input(),
      NOW,
    );
    expect(status.stage).toBe("retrying");
    expect(status.turn).toBe("none");
    expect(status.stageBeforeRetry).toBe("implementing");
    expect(status.stageBeforeStuck).toBeNull();
  });

  it("PRの ai:retry でも、CI中・レビュー中より優先される", () => {
    const status = getIssueStatus(
      issue(),
      input([pull({ labels: ["ai:review", "ai:retry"] })], { 11: { checkRuns: [check()] } }),
      NOW,
    );
    expect(status.stage).toBe("retrying");
    expect(status.stageBeforeRetry).toBe("reviewing");
  });

  it("ai:stuck と両方付いたら止まったが優先される", () => {
    const status = getIssueStatus(issue({ labels: ["ai:retry", "ai:stuck"] }), input(), NOW);
    expect(status.stage).toBe("stuck");
    expect(status.retry).toBeNull();
    expect(status.stageBeforeRetry).toBeNull();
  });

  it("マージ済みのPRでは出ない", () => {
    const status = getIssueStatus(
      issue({ state: "closed", labels: ["ai:retry"] }),
      input([mergedPull("2026-10-25T11:00:00Z", { labels: ["ai:retry"] })]),
      NOW,
    );
    expect(status.stage).toBe("deployed");
    expect(status.stageBeforeRetry).toBeNull();
  });

  it("閉じたIssueでは出ない", () => {
    const status = getIssueStatus(issue({ state: "closed", labels: ["ai:retry"] }), input(), NOW);
    expect(status.stage).not.toBe("retrying");
  });

  it("ai:retry が無ければ出ない", () => {
    const status = getIssueStatus(issue({ labels: ["ai:implement"] }), input(), NOW);
    expect(status.stage).toBe("implementing");
    expect(status.retry).toBeNull();
  });

  it("記録のコメントから回数と理由を読む（Issueでも、PRでも）", () => {
    const onIssue = getIssueStatus(
      issue({ labels: ["ai:retry"] }),
      input([], {}, [retryComment()]),
      NOW,
    );
    expect(onIssue.retry).toEqual({ count: 3, max: 10, reason: "使用量の上限に達しました" });
    const onPull = getIssueStatus(
      issue(),
      input([pull({ labels: ["ai:retry"] })], { 11: { checkRuns: [ciRunning] } }, [
        retryComment({ issueNumber: 11 }),
      ]),
      NOW,
    );
    expect(onPull.retry).toEqual({ count: 3, max: 10, reason: "使用量の上限に達しました" });
  });

  it("記録のコメントが無い・読めないときは回数を出さない", () => {
    expect(
      getIssueStatus(issue({ labels: ["ai:retry"] }), input(), NOW).retry,
    ).toBeNull();
    expect(
      getIssueStatus(
        issue({ labels: ["ai:retry"] }),
        input([], {}, [retryComment({ body: "<!-- auto-retry -->\nよく分からない文" })]),
        NOW,
      ).retry,
    ).toBeNull();
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
    const statuses = [{ context: "ci/other", state: "success", description: "", updatedAt: "2026-10-25T11:55:00Z" }];
    expect(deployState(statuses, "2026-10-25T11:50:00Z", NOW)).toEqual({ state: "deploying", unknown: false });
  });

  it("ちょうど30分で公開済み（状況は不明）", () => {
    expect(deployState([], "2026-10-25T11:30:00Z", NOW)).toEqual({ state: "deployed", unknown: true });
  });

  it("いちばん新しいVercelのステータスを使う", () => {
    const statuses = [
      { context: "Vercel", state: "success", description: "", updatedAt: "2026-10-25T11:58:00Z" },
      { context: "Vercel", state: "pending", description: "", updatedAt: "2026-10-25T11:51:00Z" },
    ];
    expect(deployState(statuses, "2026-10-25T11:50:00Z", NOW).state).toBe("deployed");
  });

  const MERGED = "2026-10-25T11:50:00Z";
  const failed = [{ context: "Vercel", state: "failure", description: "limit", updatedAt: "2026-10-25T11:55:00Z" }];

  it("マージ後に公開が失敗 → あとの公開が成功 → 公開済み", () => {
    expect(deployState(failed, MERGED, NOW, "2026-10-25T11:58:00Z")).toEqual({ state: "deployed", unknown: false });
  });

  it("あとの公開も失敗（成功が無い）なら「公開に失敗」のまま", () => {
    expect(deployState(failed, MERGED, NOW, null)).toEqual({ state: "failed", unknown: false });
  });

  it("成功の時刻がマージより前なら「公開に失敗」のまま", () => {
    expect(deployState(failed, MERGED, NOW, "2026-10-25T11:40:00Z")).toEqual({ state: "failed", unknown: false });
  });

  it("error でも、あとの公開が成功していれば公開済み", () => {
    const errored = [{ context: "Vercel", state: "error", description: "", updatedAt: "2026-10-25T11:55:00Z" }];
    expect(deployState(errored, MERGED, NOW, "2026-10-25T11:58:00Z").state).toBe("deployed");
  });

  it("公開中（pending）は、あとの公開が成功していても変えない", () => {
    const pending = [{ context: "Vercel", state: "pending", description: "", updatedAt: "2026-10-25T11:55:00Z" }];
    expect(deployState(pending, MERGED, NOW, "2026-10-25T11:58:00Z").state).toBe("deploying");
  });

  it("公開ステータスが無いときは、あとの公開があっても今までどおり", () => {
    expect(deployState([], MERGED, NOW, "2026-10-25T11:58:00Z").state).toBe("deploying");
  });
});

describe("hasNoDeploys", () => {
  const vercel = [{ context: "Vercel", state: "success", description: "", updatedAt: "2026-10-25T10:00:00Z" }];
  const none = (mergedAt: string) => ({ mergedAt, statuses: [] });
  const withDeploy = (mergedAt: string) => ({ mergedAt, statuses: vercel });

  it("PRが0件なら false", () => {
    expect(hasNoDeploys([], NOW)).toBe(false);
  });

  it("30分未満の物しか無いなら false（判断材料なし）", () => {
    expect(hasNoDeploys([none("2026-10-25T11:50:00Z")], NOW)).toBe(false);
  });

  it("30分以上前のPRに公開ステータスがどれも無ければ true", () => {
    expect(hasNoDeploys([none("2026-10-25T11:30:00Z"), none("2026-10-24T09:00:00Z")], NOW)).toBe(true);
  });

  it("1件でも公開ステータスがあれば false", () => {
    expect(hasNoDeploys([none("2026-10-25T11:00:00Z"), withDeploy("2026-10-24T09:00:00Z")], NOW)).toBe(false);
  });

  it("30分未満の物は数えない", () => {
    expect(hasNoDeploys([withDeploy("2026-10-25T11:50:00Z"), none("2026-10-25T11:00:00Z")], NOW)).toBe(true);
  });

  it("新しい5件より古い物は見ない", () => {
    const recent = [1, 2, 3, 4, 5].map((n) => none(`2026-10-25T0${n}:00:00Z`));
    expect(hasNoDeploys([...recent, withDeploy("2026-10-20T09:00:00Z")], NOW)).toBe(true);
    expect(hasNoDeploys([...recent.slice(1), withDeploy("2026-10-20T09:00:00Z")], NOW)).toBe(false);
  });

  it("Vercel で始まらないステータスは公開とみなさない", () => {
    const other = [{ context: "ci/other", state: "success", description: "", updatedAt: "2026-10-25T10:00:00Z" }];
    expect(hasNoDeploys([{ mergedAt: "2026-10-25T09:00:00Z", statuses: other }], NOW)).toBe(true);
  });
});

describe("公開が無いリポジトリの状態判定", () => {
  const old = () => mergedPull("2026-10-24T09:00:00Z", { number: 5, body: "Closes #1", headRef: "x" });

  it("deployState：公開が無ければマージ直後でも公開済み（不明にしない）", () => {
    expect(deployState([], "2026-10-25T11:50:00Z", NOW, null, true)).toEqual({ state: "deployed", unknown: false });
  });

  it("deployState：公開ステータスがあれば noDeploys でも今までどおり", () => {
    const pending = [{ context: "Vercel", state: "pending", description: "", updatedAt: "2026-10-25T11:55:00Z" }];
    expect(deployState(pending, "2026-10-25T11:50:00Z", NOW, null, true).state).toBe("deploying");
  });

  it("deployState：30分以上たっていれば今までどおり不明", () => {
    expect(deployState([], "2026-10-25T11:30:00Z", NOW, null, true)).toEqual({ state: "deployed", unknown: true });
  });

  it("マージ直後のPRが公開済みになる（過去のPRにも公開ステータスが無い）", () => {
    const status = getIssueStatus(issue({ state: "closed" }), input([mergedPull(), old()], { 11: {}, 5: {} }), NOW);
    expect(status.stage).toBe("deployed");
    expect(status.deployUnknown).toBe(false);
  });

  it("過去に公開ステータスが付いたPRがあれば、マージ直後は公開中", () => {
    const vercel = [{ context: "Vercel", state: "success", description: "", updatedAt: "2026-10-24T09:05:00Z" }];
    const status = getIssueStatus(
      issue({ state: "closed" }),
      input([mergedPull(), old()], { 11: {}, 5: { statuses: vercel } }),
      NOW,
    );
    expect(status.stage).toBe("deploying");
  });

  it("30分以上前にマージされたPRが無ければ、マージ直後は公開中", () => {
    const status = getIssueStatus(issue({ state: "closed" }), input([mergedPull()], { 11: {} }), NOW);
    expect(status.stage).toBe("deploying");
  });
});

describe("latestSuccessDeployAt", () => {
  it("Vercel の success のうち、いちばん新しい時刻を返す", () => {
    const statuses = [
      { context: "Vercel", state: "success", description: "", updatedAt: "2026-10-25T11:58:00Z" },
      { context: "Vercel", state: "failure", description: "", updatedAt: "2026-10-25T12:00:00Z" },
      { context: "Vercel", state: "success", description: "", updatedAt: "2026-10-25T11:30:00Z" },
      { context: "ci/other", state: "success", description: "", updatedAt: "2026-10-25T11:59:00Z" },
    ];
    expect(latestSuccessDeployAt(statuses)).toBe("2026-10-25T11:58:00Z");
  });

  it("説明が Ignored Build Step の success は数えない（前後の空白は無視）", () => {
    const ignored = {
      context: "Vercel",
      state: "success",
      description: " Canceled by Ignored Build Step ",
      updatedAt: "2026-10-25T12:00:00Z",
    };
    const deployed = {
      context: "Vercel",
      state: "success",
      description: "Deployment has completed",
      updatedAt: "2026-10-25T11:00:00Z",
    };
    expect(latestSuccessDeployAt([ignored, deployed])).toBe("2026-10-25T11:00:00Z");
    expect(latestSuccessDeployAt([ignored])).toBeNull();
  });

  it("成功が無ければ null", () => {
    expect(latestSuccessDeployAt([])).toBeNull();
  });
});

/** テスト中の名前（head＝今の先頭コミット、old／a／b＝以前の先頭コミット）を16進のSHAにして依頼コメントを作る */
const SHA: Record<string, string> = { head: "c0ffee", old: "a1b2c3", a: "a1", b: "b2" };

function fixRequest(name: string, createdAt: string): CommentData {
  const sha = SHA[name];
  return comment({
    issueNumber: 11,
    author: "Gaku1205",
    createdAt,
    body: `@claude 直して\n\n<!-- auto-fix -->\n<!-- auto-fix-sha: ${sha} -->`,
  });
}

describe("getIssueStatus：修正中・修正の確認中・清書した・修正した", () => {
  const checks = { 11: { checkRuns: [check()] } };

  it("修正中：最新の修正依頼のSHAが先頭コミットのまま（レビュー中より優先）", () => {
    const status = getIssueStatus(
      issue(),
      input([pull({ labels: ["ai:review"] })], checks, [fixRequest("head", "2026-10-25T10:20:00Z")]),
      NOW,
    );
    expect(status.stage).toBe("fixing");
    expect(status.turn).toBe("ai");
    expect(status.fixCount).toBe(1);
    expect(status.verifyingFix).toBe(false);
  });

  it("修正中ではない：先頭コミットが進んでいる", () => {
    const status = getIssueStatus(issue(), input([pull()], checks, [fixRequest("old", "2026-10-25T10:20:00Z")]), NOW);
    expect(status.stage).not.toBe("fixing");
  });

  it("修正した：依頼の数（1回）", () => {
    const status = getIssueStatus(issue(), input([pull()], checks, [fixRequest("old", "2026-10-25T10:20:00Z")]), NOW);
    expect(status.fixCount).toBe(1);
  });

  it("修正した：2回。修正中の依頼も数える", () => {
    const twice = getIssueStatus(
      issue(),
      input([pull()], checks, [fixRequest("a", "2026-10-25T10:20:00Z"), fixRequest("b", "2026-10-25T10:40:00Z")]),
      NOW,
    );
    expect(twice.fixCount).toBe(2);
    const secondInProgress = getIssueStatus(
      issue(),
      input([pull()], checks, [fixRequest("a", "2026-10-25T10:20:00Z"), fixRequest("head", "2026-10-25T10:40:00Z")]),
      NOW,
    );
    expect(secondInProgress.stage).toBe("fixing");
    expect(secondInProgress.fixCount).toBe(2);
  });

  it("修正の確認中：直したあと、CIが失敗", () => {
    const status = getIssueStatus(
      issue(),
      input([pull()], { 11: { checkRuns: [check(), ciFailed] } }, [fixRequest("old", "2026-10-25T10:20:00Z")]),
      NOW,
    );
    expect(status.stage).toBe("ciFailed");
    expect(status.verifyingFix).toBe(true);
  });

  it("修正の確認中：直したあと、CIが実行中", () => {
    const status = getIssueStatus(
      issue(),
      input([pull()], { 11: { checkRuns: [check(), ciRunning] } }, [fixRequest("old", "2026-10-25T10:20:00Z")]),
      NOW,
    );
    expect(status.stage).toBe("ciRunning");
    expect(status.verifyingFix).toBe(true);
  });

  it("修正の確認中：直したあと、レビュー中", () => {
    const status = getIssueStatus(
      issue(),
      input([pull({ labels: ["ai:review"] })], checks, [fixRequest("old", "2026-10-25T10:20:00Z")]),
      NOW,
    );
    expect(status.stage).toBe("reviewing");
    expect(status.verifyingFix).toBe(true);
  });

  it("修正の確認中ではない：直していない", () => {
    const status = getIssueStatus(issue(), input([pull()], { 11: { checkRuns: [check(), ciRunning] } }), NOW);
    expect(status.verifyingFix).toBe(false);
    expect(status.fixCount).toBe(0);
  });

  it("清書した：Issue本文に「> 元のメモ：」がある", () => {
    expect(getIssueStatus(issue({ body: "### 背景\n\n> 元のメモ：ほげ" }), input(), NOW).planned).toBe(true);
    expect(getIssueStatus(issue({ body: "ほげ" }), input(), NOW).planned).toBe(false);
  });

  it("止まった：止まる前の段階が修正中でも返る", () => {
    const status = getIssueStatus(
      issue({ labels: ["ai:stuck"] }),
      input([pull()], checks, [fixRequest("head", "2026-10-25T10:20:00Z")]),
      NOW,
    );
    expect(status.stage).toBe("stuck");
    expect(status.stageBeforeStuck).toBe("fixing");
  });
});
