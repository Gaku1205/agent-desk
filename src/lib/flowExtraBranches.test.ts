import { describe, expect, it } from "vitest";
import {
  critiqueScore,
  extraRowLabel,
  flowFacts,
  getFlowExtras,
  hasReviewFindings,
  type FlowFacts,
} from "./flowExtraBranches";
import { getFlow } from "./flow";
import type { CommentData, PullData } from "./github/types";
import type { IssueStatus } from "./status";
import type { StepInfo } from "./stepLog";

function pull(overrides: Partial<PullData> = {}): PullData {
  return {
    number: 38,
    title: "t",
    body: "Closes #23",
    state: "open",
    merged: false,
    labels: [],
    url: "https://github.com/o/r/pull/38",
    headRef: "claude/issue-23-x",
    headSha: "abc",
    mergeCommitSha: null,
    createdAt: "2026-11-16T00:00:00Z",
    updatedAt: "2026-11-16T00:00:00Z",
    mergedAt: null,
    ...overrides,
  };
}

function status(overrides: Partial<IssueStatus>): IssueStatus {
  return {
    stage: "notStarted",
    turn: "human",
    stageBeforeStuck: null,
    stageBeforeRetry: null,
    retry: null,
    pull: null,
    ci: { passed: 0, total: 0 },
    mergeWait: null,
    implementError: false,
    deployUnknown: false,
    stuckReason: null,
    holdRequest: null,
    planned: true,
    fixCount: 0,
    verifyingFix: false,
    reviewedClean: true,
    grace: null,
    ...overrides,
  };
}

function facts(overrides: Partial<FlowFacts> = {}): FlowFacts {
  return { labels: [], mocks: false, reviewFindings: false, ...overrides };
}

const LOG: StepInfo[] = [{ key: "plan", model: "opus", duration: "3分", started: "10:01" }];

function comment(issueNumber: number, body: string, author = "claude[bot]", id = 1): CommentData {
  return { id, issueNumber, author, body, createdAt: "2026-11-16T00:00:00Z" };
}

describe("getFlowExtras", () => {
  it("起きていない枝は出さない（ラベルも指摘も進捗ログも無い）", () => {
    for (const stage of ["notStarted", "planning", "implementing", "ciFailed", "reviewing", "deployed"] as const) {
      expect(getFlowExtras({ status: status({ stage }), facts: facts(), stepLog: null })).toEqual({
        branches: [],
        design: null,
      });
    }
  });

  it("企画の待ち：質問・他の作業の完了待ち・順番待ちを、この順に1行ずつ", () => {
    const result = getFlowExtras({
      status: status({ stage: "question" }),
      facts: facts({ labels: ["ai:queue", "ai:question", "ai:blocked"] }),
      stepLog: null,
    });
    expect(result.branches).toEqual([
      {
        kind: "wait",
        anchor: "plan",
        head: "企画の待ち",
        rows: [
          { label: "質問待ち", state: "waiting" },
          { label: "他の作業の完了待ち", state: "waiting" },
          { label: "順番待ち", state: "waiting" },
        ],
        returnLine: false,
      },
    ]);
  });

  it("質問に答えたあと（企画中）は、質問待ちを成功にする", () => {
    const result = getFlowExtras({
      status: status({ stage: "planning" }),
      facts: facts({ labels: ["ai:question", "ai:plan"] }),
      stepLog: null,
    });
    expect(result.branches[0].rows).toEqual([{ label: "質問待ち", state: "done" }]);
  });

  it("順番待ちだけ", () => {
    const result = getFlowExtras({ status: status({ stage: "queued" }), facts: facts({ labels: ["ai:queue"] }), stepLog: null });
    expect(result.branches.map((b) => b.rows.map((r) => r.label))).toEqual([["順番待ち"]]);
  });

  it("画面案あり：質問のコメントに画面案があれば、デザインを成功にする", () => {
    const result = getFlowExtras({ status: status({ stage: "question" }), facts: facts({ mocks: true }), stepLog: null });
    expect(result.design).toBe("made");
  });

  it("画面案あり：進捗ログに mocks の記録がある", () => {
    const result = getFlowExtras({
      status: status({ stage: "ciRunning" }),
      facts: facts(),
      stepLog: [...LOG, { key: "design", model: "opus", duration: null, started: "10:05" }],
    });
    expect(result.design).toBe("made");
  });

  it("画面案を通らなかった：進捗ログがあり、mocks が無く、実装より下まで進んだら飛ばした", () => {
    expect(getFlowExtras({ status: status({ stage: "implementing" }), facts: facts(), stepLog: LOG }).design).toBe("skipped");
    expect(getFlowExtras({ status: status({ stage: "deployed" }), facts: facts(), stepLog: LOG }).design).toBe("skipped");
  });

  it("まだ企画・進捗ログが無い・空のときは、デザインは今までどおり", () => {
    expect(getFlowExtras({ status: status({ stage: "planning" }), facts: facts(), stepLog: LOG }).design).toBeNull();
    expect(getFlowExtras({ status: status({ stage: "ciRunning" }), facts: facts(), stepLog: null }).design).toBeNull();
    expect(getFlowExtras({ status: status({ stage: "ciRunning" }), facts: facts(), stepLog: [] }).design).toBeNull();
  });

  it("審査：8点未満なら、実装の下に実装に戻る枝", () => {
    const body = "Closes #23\n\n## 審査役（画面の画像だけを見る別のAI）の採点\n\n点数: 7.5\n判定: 直す";
    const result = getFlowExtras({ status: status({ stage: "reviewing", pull: pull({ body }) }), facts: facts(), stepLog: null });
    expect(result.branches).toEqual([
      {
        kind: "critique",
        anchor: "implement",
        head: "審査",
        rows: [
          { label: "審査 7.5点 / 10", state: "failed" },
          { label: "実装に戻る", state: "done" },
        ],
        returnLine: true,
      },
    ]);
  });

  it("審査：8点以上・読めないときは出さない", () => {
    for (const body of ["## 審査役の採点\n\n点数: 8.0", "## 審査役の採点\n\n点数: 9", "点数: 5", "## 審査役\n\n点数: なし"]) {
      const result = getFlowExtras({ status: status({ stage: "reviewing", pull: pull({ body }) }), facts: facts(), stepLog: null });
      expect(result.branches).toEqual([]);
    }
  });

  it("レビューの指摘：修正中は 修正 進行中・CIに戻る 待ち、戻る線あり", () => {
    const result = getFlowExtras({
      status: status({ stage: "fixing", pull: pull(), fixCount: 1 }),
      facts: facts({ reviewFindings: true }),
      stepLog: null,
    });
    expect(result.branches).toEqual([
      {
        kind: "reviewFix",
        anchor: "review",
        head: "レビューの指摘",
        rows: [
          { label: "指摘あり", state: "failed" },
          { label: "修正", state: "running" },
          { label: "CIに戻る", state: "waiting" },
        ],
        returnLine: true,
      },
    ]);
  });

  it("レビューの指摘：修正の確認中・そのあと・依頼がまだ・止まった", () => {
    const rows = (s: IssueStatus) =>
      getFlowExtras({ status: s, facts: facts({ reviewFindings: true }), stepLog: null }).branches[0];
    expect(rows(status({ stage: "ciRunning", fixCount: 1, verifyingFix: true })).rows.map((r) => r.state)).toEqual([
      "failed",
      "done",
      "running",
    ]);
    expect(rows(status({ stage: "ciFailed", fixCount: 1, verifyingFix: true })).rows.map((r) => r.state)).toEqual([
      "failed",
      "done",
      "failed",
    ]);
    expect(rows(status({ stage: "mergeWaiting", mergeWait: "autoMerge", fixCount: 1 })).rows.map((r) => r.state)).toEqual([
      "failed",
      "done",
      "done",
    ]);
    const before = rows(status({ stage: "mergeWaiting", mergeWait: "needsReview", fixCount: 0 }));
    expect(before.rows.map((r) => r.state)).toEqual(["failed", "waiting", "waiting"]);
    expect(before.returnLine).toBe(false);
    const stuck = rows(status({ stage: "stuck", stageBeforeStuck: "fixing", fixCount: 1 }));
    expect(stuck.rows[1].state).toBe("failed");
  });

  it("マージ待ち：ai:hold（PR）のマージ待ちは待ち、マージしたあとは成功。修正の下に置く", () => {
    const waiting = getFlowExtras({
      status: status({ stage: "mergeWaiting", mergeWait: "hold", pull: pull({ labels: ["ai:hold", "ai:review"] }) }),
      facts: facts(),
      stepLog: null,
    });
    expect(waiting.branches).toEqual([
      { kind: "mergeHold", anchor: "fix", head: "マージ", rows: [{ label: "人間のマージ待ち", state: "waiting" }], returnLine: false },
    ]);
    const merged = getFlowExtras({
      status: status({ stage: "deployed", pull: pull({ labels: ["ai:hold"], merged: true }) }),
      facts: facts(),
      stepLog: null,
    });
    expect(merged.branches[0].rows).toEqual([{ label: "人間のマージ待ち", state: "done" }]);
    // マージ待ちより前は出さない
    const ci = getFlowExtras({ status: status({ stage: "ciRunning", pull: pull({ labels: ["ai:hold"] }) }), facts: facts(), stepLog: null });
    expect(ci.branches).toEqual([]);
  });

  it("止まった：止まった工程の下に、あなたの番への枝", () => {
    const s = status({ stage: "stuck", stageBeforeStuck: "ciFailed", pull: pull({ labels: ["ai:stuck"] }), fixCount: 2 });
    const result = getFlowExtras({ status: s, facts: facts(), stepLog: null });
    expect(result.branches).toEqual([
      { kind: "stuck", anchor: "ci", head: "止まった", rows: [{ label: "Your turn", state: "waiting" }], returnLine: false },
    ]);
    // CI失敗時の分岐（getFlow）は変えない
    expect(getFlow(s).branch).toEqual({ n: 3, fixState: "failed", branch: "active", returnLine: true });
  });

  it("止まる前が分からないときは企画の下", () => {
    const result = getFlowExtras({ status: status({ stage: "stuck" }), facts: facts(), stepLog: null });
    expect(result.branches[0].anchor).toBe("plan");
  });
});

describe("critiqueScore", () => {
  it("審査役の見出しの後ろの点数を読む（全角のコロンも）", () => {
    expect(critiqueScore("## 審査役の採点\n点数: 7.5")).toEqual({ text: "7.5", value: 7.5 });
    expect(critiqueScore("### 審査役\n\n点数：6")).toEqual({ text: "6", value: 6 });
  });
  it("見出しの前の点数は読まない", () => {
    expect(critiqueScore("点数: 3\n## 審査役")).toBeNull();
    expect(critiqueScore("")).toBeNull();
  });
});

describe("flowFacts / hasReviewFindings", () => {
  it("指摘ありのレビューのコメント（claude[bot]）があるか", () => {
    const comments = [
      comment(38, "## Code review\n\n指摘が1件あります", "claude[bot]", 1),
      comment(38, "## Code review\n\nNo issues found.", "claude[bot]", 2),
    ];
    expect(hasReviewFindings(comments, 38)).toBe(true);
    expect(hasReviewFindings([comments[1]], 38)).toBe(false);
    expect(hasReviewFindings([comment(38, "## Code review\n\n指摘", "someone")], 38)).toBe(false);
    expect(hasReviewFindings(comments, null)).toBe(false);
  });

  it("画面案は、最新の質問のコメントに画面案の画像があるとき", () => {
    const withMocks = comment(18, '<!-- ai-question -->\n**Q1. 色は？**\n\n<!-- ai-mocks: issue-18/r1 -->\n### A. 明るい\n<img src="/a.svg" alt="A PC">');
    const issue = { number: 18, labels: ["ai:question"] };
    expect(flowFacts(issue, { pull: null }, [withMocks], "owner")).toEqual({ labels: ["ai:question"], mocks: true, reviewFindings: false });
    expect(flowFacts(issue, { pull: null }, [comment(18, "<!-- ai-question -->\n**Q1. 色は？**")], "owner").mocks).toBe(false);
  });
});

describe("extraRowLabel", () => {
  it("行の読み上げ", () => {
    expect(extraRowLabel({ label: "質問待ち", state: "waiting" })).toBe("質問待ち　待ち");
    expect(extraRowLabel({ label: "審査 7.5点 / 10", state: "failed" })).toBe("審査 7.5点 / 10　失敗");
  });
});
