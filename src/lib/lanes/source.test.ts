import { describe, expect, it } from "vitest";
import type { CommentData, IssueData, PullData, RepoData, RepoResult, WorkflowRunData } from "../github/types";
import { buildLanesSource, modelLabel, runKind, runTarget } from "./source";

const NOW = new Date("2026-11-18T02:13:00Z");

function issue(number: number, labels: string[] = [], body = ""): IssueData {
  return {
    number,
    title: `Issue ${number}`,
    body,
    state: "open",
    labels,
    url: `https://github.com/o/r/issues/${number}`,
    createdAt: "2026-11-18T01:00:00Z",
    updatedAt: "2026-11-18T01:00:00Z",
    closedAt: null,
  };
}

function pull(number: number, over: Partial<PullData> = {}): PullData {
  return {
    number,
    title: `PR ${number}`,
    body: "",
    state: "open",
    merged: false,
    labels: [],
    url: `https://github.com/o/r/pull/${number}`,
    headRef: "",
    headSha: "",
    mergeCommitSha: null,
    createdAt: "2026-11-18T01:00:00Z",
    updatedAt: "2026-11-18T01:00:00Z",
    mergedAt: null,
    ...over,
  };
}

function run(over: Partial<WorkflowRunData> = {}): WorkflowRunData {
  return { status: "in_progress", headBranch: null, displayTitle: "", pullNumbers: [], updatedAt: "2026-11-18T02:12:00Z", ...over };
}

function data(over: Partial<RepoData>): RepoData {
  return { issues: [], pulls: [], comments: [], pullChecks: {}, events: [], ...over };
}

function result(repoData: RepoData, repo = "r"): RepoResult {
  return { owner: "o", repo, ok: true, data: repoData };
}

const touches = (paths: string) => `本文\n<!-- ai-touches: ${paths} -->`;

describe("buildLanesSource：枠を使う作業", () => {
  it("実装中の Issue は枠を使い、企画中・順番待ちは使わない", () => {
    const source = buildLanesSource(
      [result(data({ issues: [issue(3, ["ai:implement"]), issue(4, ["ai:plan"]), issue(5, ["ai:queue"])] }))],
      NOW,
    );
    expect(source.works.map((work) => [work.number, work.stepText, work.stepName])).toEqual([[3, "実装しています", "実装"]]);
  });

  it("経過時間は、進捗ログの今の工程の行の開始から", () => {
    const log: CommentData = {
      id: 1,
      issueNumber: 3,
      author: "github-actions[bot]",
      body: '<!-- ai-step-log -->\n<!-- ai-step {"step":"implement","model":"opus","result":"running","started":"2026-11-18T01:51:00Z","finished":null} -->',
      createdAt: "2026-11-18T01:51:00Z",
    };
    const source = buildLanesSource([result(data({ issues: [issue(3, ["ai:implement"])], comments: [log] }))], NOW);
    expect(source.works[0].elapsedMs).toBe(22 * 60_000);
  });

  it("取れなかったリポジトリは飛ばす", () => {
    const failed: RepoResult = { owner: "o", repo: "x", ok: false, error: { kind: "other", message: "x" } };
    expect(buildLanesSource([failed], NOW)).toEqual({ works: [], queue: [], runs: [] });
  });
});

describe("buildLanesSource：順番待ちの理由と相手", () => {
  it("動いている作業と触るファイルが重なれば overlap、相手はその作業", () => {
    const source = buildLanesSource(
      [
        result(
          data({
            issues: [
              issue(451, ["ai:implement"], touches("src/components/Sidebar.tsx")),
              issue(439, ["ai:queue"], touches("src/components/")),
            ],
          }),
        ),
      ],
      NOW,
    );
    expect(source.queue[0]).toMatchObject({
      number: 439,
      cause: "overlap",
      file: "src/components/Sidebar.tsx",
      waitFor: { label: "#451", url: "https://github.com/o/r/issues/451" },
    });
  });

  it("動いている作業にPRがあれば、PRの変更ファイルで比べる", () => {
    const source = buildLanesSource(
      [
        result(
          data({
            issues: [issue(451, ["ai:implement"], touches("src/x.ts")), issue(439, ["ai:queue"], touches("src/a.ts"))],
            pulls: [pull(460, { headRef: "claude/issue-451-x", files: ["src/a.ts"] })],
          }),
        ),
      ],
      NOW,
    );
    expect(source.queue[0].cause).toBe("overlap");
  });

  it("ai:blocked は、理由の #番号 を相手にする", () => {
    const reason: CommentData = { id: 1, issueNumber: 9, author: "claude[bot]", body: "#7 が終わってから始めます", createdAt: "2026-11-18T01:00:00Z" };
    const source = buildLanesSource([result(data({ issues: [issue(9, ["ai:blocked"])], comments: [reason] }))], NOW);
    expect(source.queue[0]).toMatchObject({ cause: "blocked", waitFor: { label: "#7" } });
  });

  it("マージ待ちの PR の止めている印にあれば hold、相手はその PR", () => {
    const mark: CommentData = { id: 1, issueNumber: 20, author: "github-actions[bot]", body: "<!-- hold-blocking: #9 -->", createdAt: "2026-11-18T01:00:00Z" };
    const source = buildLanesSource(
      [
        result(
          data({
            issues: [issue(9, ["ai:queue"], touches("src/a.ts"))],
            pulls: [pull(20, { labels: ["ai:hold"], files: ["src/a.ts"] })],
            comments: [mark],
          }),
        ),
      ],
      NOW,
    );
    expect(source.queue[0]).toMatchObject({ cause: "hold", file: "src/a.ts", waitFor: { label: "PR #20" } });
  });

  it("印が無い物は、動いている作業があれば noTouches、無ければ理由なし", () => {
    const busy = buildLanesSource([result(data({ issues: [issue(1, ["ai:implement"]), issue(9, ["ai:queue"])] }))], NOW);
    expect(busy.queue[0].cause).toBe("noTouches");
    const idle = buildLanesSource([result(data({ issues: [issue(9, ["ai:queue"])] }))], NOW);
    expect(idle.queue[0].cause).toBeNull();
  });

  it("動いている作業の触るファイルが分からなければ unknownInflight", () => {
    const source = buildLanesSource(
      [result(data({ issues: [issue(1, ["ai:implement"]), issue(9, ["ai:queue"], touches("src/a.ts"))] }))],
      NOW,
    );
    expect(source.queue[0]).toMatchObject({ cause: "unknownInflight", waitFor: { label: "#1" } });
  });

  it("次に入る順：リポジトリの並び → 急ぎ → ほかの ai:queue → ai:blocked、それぞれ番号の小さい順", () => {
    const first = data({ issues: [issue(5, ["ai:blocked"]), issue(8, ["ai:queue"]), issue(9, ["ai:queue", "priority:high"])] });
    const second = data({ issues: [issue(1, ["ai:queue"])] });
    const source = buildLanesSource([result(first, "a"), result(second, "b")], NOW);
    expect(source.queue.map((entry) => `${entry.repo}#${entry.number}`)).toEqual(["a#9", "a#8", "a#5", "b#1"]);
  });

  it("待ち時間は、ai:queue が最後に付いてから。取れなければ null", () => {
    const events = [{ event: "labeled", labelName: "ai:queue", issueNumber: 9, createdAt: "2026-11-18T00:13:00Z" }];
    const source = buildLanesSource([result(data({ issues: [issue(9, ["ai:queue"]), issue(10, ["ai:queue"])], events }))], NOW);
    expect(source.queue.map((entry) => entry.waitingMs)).toEqual([2 * 60 * 60_000, null]);
  });
});

describe("buildLanesSource：いま動いている実行", () => {
  it("実行中の物だけを、同じ実行は1つにして、始まった古い順に並べる", () => {
    const runs = [
      run({ id: 2, name: "CI", startedAt: "2026-11-18T02:10:00Z", headBranch: "claude/issue-3-x" }),
      run({ id: 1, name: "Claude Implement", startedAt: "2026-11-18T01:50:00Z", headBranch: "claude/issue-3-x" }),
      run({ id: 1, name: "Claude Implement", startedAt: "2026-11-18T01:50:00Z", headBranch: "claude/issue-3-x" }),
      run({ id: 4, status: "completed", name: "Watchdog" }),
    ];
    const source = buildLanesSource([result(data({ issues: [issue(3, ["ai:implement"])], runs }))], NOW);
    expect(source.runs.map((entry) => [entry.kind, entry.issueNumber, entry.elapsedMs, entry.logUrl])).toEqual([
      ["Implement", 3, 23 * 60_000, "https://github.com/o/r/actions/runs/1"],
      ["CI", 3, 3 * 60_000, "https://github.com/o/r/actions/runs/2"],
    ]);
    expect(source.runs[0].detail).toBe("実装");
  });

  it("今していることが無ければ実行の題名。始まった時刻・番号が無ければ出さない", () => {
    const source = buildLanesSource([result(data({ runs: [run({ name: "Watchdog", displayTitle: "見張り" })] }))], NOW);
    expect(source.runs[0]).toMatchObject({ kind: "Watchdog", issueNumber: null, activity: "見張り", elapsedMs: null, logUrl: null, detail: null });
  });
});

describe("runTarget", () => {
  const repoData = data({ issues: [issue(3)], pulls: [pull(7, { headRef: "claude/issue-3-x" })] });

  it("ブランチ・紐づくPR・題名の #番号 から Issue と PR を決める", () => {
    expect(runTarget(run({ headBranch: "claude/issue-3-x" }), repoData)).toEqual({ issue: 3, pull: 7 });
    expect(runTarget(run({ pullNumbers: [7] }), repoData)).toEqual({ issue: 3, pull: 7 });
    expect(runTarget(run({ displayTitle: "PR #7 のレビュー" }), repoData)).toEqual({ issue: 3, pull: 7 });
    expect(runTarget(run({ displayTitle: "main" }), repoData)).toEqual({ issue: null, pull: null });
  });
});

describe("runKind・modelLabel", () => {
  it("ワークフローの名前から種類。知らない物は名前のまま、無ければ Actions", () => {
    expect(runKind("Claude Implement")).toBe("Implement");
    expect(runKind("Claude Review")).toBe("Review");
    expect(runKind("Claude Plan")).toBe("Plan");
    expect(runKind("Claude Mention")).toBe("Fix");
    expect(runKind("Deploy Vercel")).toBe("Deploy");
    expect(runKind("Watchdog")).toBe("Watchdog");
    expect(runKind("Queue")).toBe("Queue");
    expect(runKind(undefined)).toBe("Actions");
  });

  it("モデル名を画面の名前に", () => {
    expect(modelLabel("claude-opus-5-5")).toBe("Opus");
    expect(modelLabel("sonnet")).toBe("Sonnet");
    expect(modelLabel("gpt")).toBe("gpt");
    expect(modelLabel(null)).toBeNull();
  });
});
