import { describe, expect, it } from "vitest";
import {
  aiActivity,
  commentUrl,
  currentStepFromJobs,
  pickWorkingComment,
  readTaskList,
  STEP_PROBE_MAX,
  stepProbeRunIds,
  todoActivity,
} from "./aiActivity";
import type { CommentData, IssueData, PullData, RepoData, WorkflowRunData } from "./github/types";

const BOT = "claude[bot]";

function comment(id: number, body: string, overrides: Partial<CommentData> = {}): CommentData {
  return { id, issueNumber: 21, author: BOT, body, createdAt: "2026-11-16T10:00:00Z", ...overrides };
}

const WORKING = ["Claude Code is working…", "", "- [x] 仕様を読む", "- [x] **型**を足す", "- [ ] `Conversation` を直す", "- [ ] テストを書く"].join(
  "\n",
);

function issue(number: number, overrides: Partial<IssueData> = {}): IssueData {
  return {
    number,
    title: `#${number}`,
    body: "",
    state: "open",
    labels: ["ai:implement"],
    url: `https://github.com/o/r/issues/${number}`,
    createdAt: "2026-11-16T09:00:00Z",
    updatedAt: "2026-11-16T09:00:00Z",
    closedAt: null,
    ...overrides,
  };
}

function run(id: number, issueNumber: number, overrides: Partial<WorkflowRunData> = {}): WorkflowRunData {
  return {
    id,
    status: "in_progress",
    headBranch: `claude/issue-${issueNumber}-x`,
    displayTitle: "",
    pullNumbers: [],
    updatedAt: "2026-11-16T10:00:00Z",
    ...overrides,
  };
}

function data(overrides: Partial<RepoData> = {}): RepoData {
  return { issues: [issue(21)], pulls: [], comments: [], pullChecks: {}, events: [], runs: [], ...overrides };
}

describe("readTaskList", () => {
  it("やることの一覧を上から読み、飾りを外す", () => {
    expect(readTaskList(WORKING)).toEqual([
      { done: true, text: "仕様を読む" },
      { done: true, text: "型を足す" },
      { done: false, text: "Conversation を直す" },
      { done: false, text: "テストを書く" },
    ]);
  });

  it("[X]・* の箇条書きも読み、一覧でない行は読まない", () => {
    expect(readTaskList("* [X] 終わった\n- 普通の行\n- [ ]   \n  - [ ] 字下げ")).toEqual([
      { done: true, text: "終わった" },
      { done: false, text: "字下げ" },
    ]);
  });
});

describe("pickWorkingComment", () => {
  it("いちばん新しく更新された作業中のコメントを選ぶ", () => {
    const older = comment(1, WORKING, { updatedAt: "2026-11-16T10:05:00Z" });
    const newer = comment(2, "- [ ] 別の作業", { createdAt: "2026-11-16T09:00:00Z", updatedAt: "2026-11-16T10:10:00Z" });
    expect(pickWorkingComment([older, newer], [21])?.id).toBe(2);
  });

  it("いちばん新しい物が完了していれば出さない", () => {
    const working = comment(1, WORKING);
    const finished = comment(2, "**Claude finished @gaku's task in 3m** \n\n- [x] 仕様を読む", {
      createdAt: "2026-11-16T10:20:00Z",
    });
    expect(pickWorkingComment([working, finished], [21])).toBeNull();
    expect(pickWorkingComment([comment(3, "**Claude encountered an error after 1m**")], [21])).toBeNull();
  });

  it("人のコメント・お願いのコメント・ほかの Issue のコメントは使わない", () => {
    expect(pickWorkingComment([comment(1, WORKING, { author: "gaku" })], [21])).toBeNull();
    expect(pickWorkingComment([comment(1, "<!-- human-request -->\n- [ ] 決めてください")], [21])).toBeNull();
    expect(pickWorkingComment([comment(1, WORKING, { issueNumber: 22 })], [21])).toBeNull();
  });

  it("紐づく PR のコメントも使う", () => {
    expect(pickWorkingComment([comment(1, WORKING, { issueNumber: 40 })], [21, 40])?.id).toBe(1);
  });

  describe("修正AIの実行が終わっているとき（Issue #609）", () => {
    const pulls = [{ number: 40, headRef: "claude/issue-21-x" }];
    const fixRun = (overrides: Partial<WorkflowRunData> = {}): WorkflowRunData => ({
      id: 7,
      status: "completed",
      conclusion: "cancelled",
      name: "Claude Mention",
      headBranch: "claude/issue-21-x",
      displayTitle: "",
      pullNumbers: [40],
      startedAt: "2026-11-16T09:50:00Z",
      updatedAt: "2026-11-16T10:30:00Z",
      ...overrides,
    });
    const onPull = [comment(1, WORKING, { issueNumber: 40 })];

    it("取り消し・失敗・時間切れで終わっていれば拾わない", () => {
      for (const conclusion of ["cancelled", "failure", "timed_out"]) {
        expect(pickWorkingComment(onPull, [21, 40], [fixRun({ conclusion })], pulls)).toBeNull();
      }
    });

    it("実行が動いている・成功・一覧が取れていないときは拾う", () => {
      expect(pickWorkingComment(onPull, [21, 40], [fixRun({ status: "in_progress", conclusion: undefined })], pulls)?.id).toBe(1);
      expect(pickWorkingComment(onPull, [21, 40], [fixRun({ conclusion: "success" })], pulls)?.id).toBe(1);
      expect(pickWorkingComment(onPull, [21, 40], null, pulls)?.id).toBe(1);
    });

    it("その実行より前のコメント・修正AI以外の実行は関係ない", () => {
      expect(pickWorkingComment(onPull, [21, 40], [fixRun({ startedAt: "2026-11-16T10:30:00Z" })], pulls)?.id).toBe(1);
      expect(pickWorkingComment(onPull, [21, 40], [fixRun({ name: "Claude Review" })], pulls)?.id).toBe(1);
    });
  });
});

describe("todoActivity", () => {
  it("最初の終わっていない項目と、終わった数／全部の数", () => {
    expect(todoActivity(comment(5, WORKING, { url: "https://github.com/o/r/issues/21#issuecomment-5" }), "o", "r")).toEqual({
      kind: "todo",
      current: "Conversation を直す",
      done: 2,
      total: 4,
      url: "https://github.com/o/r/issues/21#issuecomment-5",
    });
  });

  it("全部終わっていれば、やることの1行は無し", () => {
    const activity = todoActivity(comment(5, "- [x] a\n- [x] b"), "o", "r");
    expect(activity).toMatchObject({ kind: "todo", current: null, done: 2, total: 2 });
  });

  it("一覧が無い作業中のコメントは、数も無し", () => {
    expect(todoActivity(comment(5, "Claude Code is working…"), "o", "r")).toMatchObject({ current: null, total: 0 });
  });
});

describe("commentUrl", () => {
  it("型に URL が無ければ、Issue のページのコメントの位置", () => {
    expect(commentUrl(comment(9, ""), "o", "r")).toBe("https://github.com/o/r/issues/21#issuecomment-9");
  });
});

describe("aiActivity", () => {
  it("作業中のコメントがあれば、それを使う", () => {
    const result = aiActivity(
      data({ comments: [comment(1, WORKING)], runs: [run(7, 21)], runSteps: [{ runId: 7, name: "Run Claude", url: null }] }),
      21,
      "o",
      "r",
    );
    expect(result).toMatchObject({ kind: "todo", current: "Conversation を直す" });
  });

  it("コメントが無ければ、動いている実行の今のステップ名", () => {
    const result = aiActivity(
      data({ runs: [run(7, 21)], runSteps: [{ runId: 7, name: "Run Claude Code", url: "https://github.com/o/r/actions/runs/7/job/1" }] }),
      21,
      "o",
      "r",
    );
    expect(result).toEqual({ kind: "step", name: "Run Claude Code", url: "https://github.com/o/r/actions/runs/7/job/1" });
  });

  it("どちらも無ければ null。完了したコメントだけなら、ステップ名に回る", () => {
    expect(aiActivity(data(), 21, "o", "r")).toBeNull();
    expect(aiActivity(data({ comments: [comment(1, "Claude finished")], runs: [run(7, 21)] }), 21, "o", "r")).toBeNull();
    expect(
      aiActivity(
        data({ comments: [comment(1, "Claude finished")], runs: [run(7, 21)], runSteps: [{ runId: 7, name: "Test", url: null }] }),
        21,
        "o",
        "r",
      ),
    ).toMatchObject({ kind: "step", name: "Test" });
  });

  it("終わった実行のステップは使わない", () => {
    expect(
      aiActivity(
        data({ runs: [run(7, 21, { status: "completed" })], runSteps: [{ runId: 7, name: "Test", url: null }] }),
        21,
        "o",
        "r",
      ),
    ).toBeNull();
  });
});

describe("stepProbeRunIds", () => {
  it("作業中のコメントが無い、開いている Issue の、いちばん新しい実行中の実行だけ", () => {
    const pull: PullData = {
      number: 40,
      title: "",
      body: "Closes #23",
      state: "open",
      merged: false,
      labels: [],
      url: "",
      headRef: "fix-23",
      headSha: "a",
      mergeCommitSha: null,
      createdAt: "",
      updatedAt: "",
      mergedAt: null,
    };
    const ids = stepProbeRunIds(
      data({
        issues: [issue(21), issue(22), issue(23), issue(24, { state: "closed" })],
        pulls: [pull],
        comments: [comment(1, WORKING, { issueNumber: 22 })],
        runs: [
          run(1, 21, { updatedAt: "2026-11-16T10:00:00Z" }),
          run(2, 21, { updatedAt: "2026-11-16T10:05:00Z" }),
          run(3, 22),
          run(4, 0, { headBranch: "fix-23" }),
          run(5, 24),
          run(6, 21, { status: "queued", updatedAt: "2026-11-16T11:00:00Z" }),
        ],
      }),
    );
    expect(ids).toEqual([2, 4]);
  });

  it("上限を超えて取りに行かない", () => {
    const issues = Array.from({ length: STEP_PROBE_MAX + 2 }, (_, i) => issue(i + 1));
    const runs = issues.map((it) => run(100 + it.number, it.number));
    expect(stepProbeRunIds(data({ issues, runs }))).toHaveLength(STEP_PROBE_MAX);
  });

  it("実行が取れなかったときは何も取りに行かない", () => {
    expect(stepProbeRunIds(data({ runs: null }))).toEqual([]);
  });
});

describe("currentStepFromJobs", () => {
  it("実行中のジョブの、実行中のステップ", () => {
    const raw = {
      jobs: [
        { status: "completed", html_url: "a", steps: [{ status: "in_progress", name: "古い" }] },
        {
          status: "in_progress",
          html_url: "https://github.com/o/r/actions/runs/7/job/2",
          steps: [
            { status: "completed", name: "Checkout" },
            { status: "in_progress", name: "Run Claude Code" },
            { status: "queued", name: "Post" },
          ],
        },
      ],
    };
    expect(currentStepFromJobs(7, raw)).toEqual({
      runId: 7,
      name: "Run Claude Code",
      url: "https://github.com/o/r/actions/runs/7/job/2",
    });
  });

  it("実行中のステップが無い・形が違うときは null", () => {
    expect(currentStepFromJobs(7, { jobs: [{ status: "in_progress", steps: [{ status: "queued", name: "x" }] }] })).toBeNull();
    expect(currentStepFromJobs(7, { jobs: "x" })).toBeNull();
    expect(currentStepFromJobs(7, null)).toBeNull();
  });
});
