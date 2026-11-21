import { describe, expect, it } from "vitest";
import type { CommentData, IssueData, PullData, RepoData, RepoResult, WorkflowRunData } from "../github/types";
import type { IssueStatus } from "../status";
import { buildLanesSource, modelLabel, occupiesSlot, runKind, runTarget } from "./source";

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

  const ciRunningPull = pull(20, { body: "Closes #7", labels: ["ai:hold"] });
  const ciRunningChecks = {
    20: {
      checkRuns: [{ name: "check", status: "in_progress", conclusion: null, appSlug: "github-actions", completedAt: null }],
      statuses: [],
    },
  };

  it("`ai:implement` の無い Issue は、開いている PR が CI 中でも席にしない", () => {
    const source = buildLanesSource(
      [result(data({ issues: [issue(7, ["ai:skip"])], pulls: [ciRunningPull], pullChecks: ciRunningChecks }))],
      NOW,
    );
    expect(source.works).toEqual([]);
  });

  it("`ai:implement` がある Issue は、PR が CI 中でも今までどおり席にする", () => {
    const source = buildLanesSource(
      [result(data({ issues: [issue(7, ["ai:implement"])], pulls: [ciRunningPull], pullChecks: ciRunningChecks }))],
      NOW,
    );
    expect(source.works.map((work) => [work.number, work.stepName])).toEqual([[7, "CI"]]);
  });

  it("CI が通ってレビューを待つ Issue（needsReview）も席にする", () => {
    const passedPull = pull(21, { body: "Closes #8" });
    const checks = {
      21: {
        checkRuns: [{ name: "check", status: "completed", conclusion: "success", appSlug: "github-actions", completedAt: "2026-11-18T02:00:00Z" }],
        statuses: [],
      },
    };
    const source = buildLanesSource(
      [result(data({ issues: [issue(8, ["ai:implement"])], pulls: [passedPull], pullChecks: checks }))],
      NOW,
    );
    expect(source.works.map((work) => [work.number, work.stepText])).toEqual([[8, "CIが通りました。レビュー待ちです"]]);
    expect(source.works[0].ci).toBeNull();
  });

  it("CI の段の作業には、CI のチェックの進み具合（枠待ちを含む）を付ける", () => {
    const ciPull = pull(21, { body: "Closes #8" });
    const run = (status: string, conclusion: string | null) => ({
      name: "check",
      status,
      conclusion,
      appSlug: "github-actions",
      completedAt: null,
    });
    const checks = {
      21: { checkRuns: [run("completed", "success"), run("queued", null), run("queued", null)], statuses: [] },
    };
    const source = buildLanesSource(
      [result(data({ issues: [issue(8, ["ai:implement"])], pulls: [ciPull], pullChecks: checks }))],
      NOW,
    );
    expect(source.works[0].ci?.counts).toEqual({ passed: 1, running: 0, queued: 2, failed: 0, total: 3 });
    expect(source.works[0].ci?.word).toBe("枠待ち");
  });

  it("取れなかったリポジトリは飛ばす", () => {
    const failed: RepoResult = { owner: "o", repo: "x", ok: false, error: { kind: "other", message: "x" } };
    expect(buildLanesSource([failed], NOW)).toEqual({ works: [], queue: [], runs: [], paused: [] });
  });
});

describe("occupiesSlot：マージ待ち", () => {
  const base: IssueStatus = {
    stage: "mergeWaiting",
    turn: "ai",
    stageBeforeStuck: null,
    stageBeforeRetry: null,
    retry: null,
    pull: null,
    ci: { passed: 1, total: 1 },
    mergeWait: "needsReview",
    implementError: false,
    deployUnknown: false,
    stuckReason: null,
    holdRequest: null,
    planned: true,
    fixCount: 0,
    verifyingFix: false,
    reviewedClean: false,
    grace: null,
  };

  it("needsReview・autoMerge は枠を使い、hold は使わない", () => {
    expect(occupiesSlot({ ...base, mergeWait: "needsReview" })).toBe(true);
    expect(occupiesSlot({ ...base, mergeWait: "autoMerge" })).toBe(true);
    expect(occupiesSlot({ ...base, mergeWait: "hold", turn: "human" })).toBe(false);
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

  it("blocked-by の印だけで止めた Issue は、印の相手（複数・別のリポジトリ・開いている物だけ）を相手にする", () => {
    const mark = (body: string): CommentData => ({ id: 1, issueNumber: 9, author: "claude[bot]", body, createdAt: "2026-11-18T01:00:00Z" });
    const single = buildLanesSource(
      [result(data({ issues: [issue(715, ["ai:implement"]), issue(9, ["ai:blocked"])], comments: [mark("<!-- blocked-by: o/r#715 -->")] }))],
      NOW,
    );
    expect(single.queue[0]).toMatchObject({ cause: "blocked", waitFor: { label: "#715" } });
    expect(single.queue[0].waitFors).toMatchObject([{ number: 715, running: true }]);

    const many = buildLanesSource(
      [
        result(
          data({
            issues: [issue(1, ["ai:plan"]), { ...issue(2), state: "closed" }, issue(9, ["ai:blocked"])],
            comments: [mark("<!-- blocked-by: o/r#1 -->\n<!-- blocked-by: o/r#2 -->\n<!-- blocked-by: o/other#3 -->")],
          }),
        ),
      ],
      NOW,
    );
    expect(many.queue[0].waitFors.map((t) => [t.number, t.otherRepo?.repo ?? null])).toEqual([
      [1, null],
      [3, "other"],
    ]);
  });

  it("印と理由の文の両方があれば印を先に使い、印が無ければ理由の文から", () => {
    const comments: CommentData[] = [
      { id: 1, issueNumber: 9, author: "claude[bot]", body: "#7 が終わってから", createdAt: "2026-11-18T01:00:00Z" },
      { id: 2, issueNumber: 9, author: "bot", body: "<!-- blocked-by: o/r#8 -->", createdAt: "2026-11-18T01:00:00Z" },
    ];
    const both = buildLanesSource([result(data({ issues: [issue(9, ["ai:blocked"])], comments }))], NOW);
    expect(both.queue[0].waitFor?.label).toBe("#8");
    const reasonOnly = buildLanesSource([result(data({ issues: [issue(9, ["ai:blocked"])], comments: [comments[0]] }))], NOW);
    expect(reasonOnly.queue[0].waitFor?.label).toBe("#7");
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

  it("重なる作業すべてを waitFors に入れ、重ならない作業は入れない", () => {
    const source = buildLanesSource(
      [
        result(
          data({
            issues: [
              issue(1, ["ai:implement"], touches("src/a.ts")),
              issue(2, ["ai:implement"], touches("src/b.ts")),
              issue(3, ["ai:implement"], touches("lib/c.ts")),
              issue(9, ["ai:queue"], touches("src/")),
            ],
          }),
        ),
      ],
      NOW,
    );
    expect(source.queue[0].waitFors.map((target) => target.number)).toEqual([1, 2]);
    expect(source.queue[0].waitFors[0]).toMatchObject({
      kind: "issue",
      title: "Issue 1",
      running: true,
      issueNumber: 1,
      url: "https://github.com/o/r/issues/1",
    });
  });

  it("unknownInflight の waitFors は、触るファイルが分からない作業だけ", () => {
    const source = buildLanesSource(
      [
        result(
          data({
            issues: [
              issue(1, ["ai:implement"]),
              issue(2, ["ai:implement"], touches("lib/x.ts")),
              issue(9, ["ai:queue"], touches("src/a.ts")),
            ],
          }),
        ),
      ],
      NOW,
    );
    expect(source.queue[0].waitFors.map((target) => target.number)).toEqual([1]);
  });

  it("blocked の waitFors は、後の Issue の題名と動いているかを持つ", () => {
    const reason: CommentData = { id: 1, issueNumber: 9, author: "claude[bot]", body: "#7 が終わってから始めます", createdAt: "2026-11-18T01:00:00Z" };
    const running = buildLanesSource(
      [result(data({ issues: [issue(7, ["ai:implement"]), issue(9, ["ai:blocked"])], comments: [reason] }))],
      NOW,
    );
    expect(running.queue[0].waitFors).toEqual([
      { kind: "issue", number: 7, title: "Issue 7", running: true, issueNumber: 7, url: "https://github.com/o/r/issues/7" },
    ]);
    const idle = buildLanesSource([result(data({ issues: [issue(9, ["ai:blocked"])], comments: [reason] }))], NOW);
    expect(idle.queue[0].waitFors).toEqual([
      { kind: "issue", number: 7, title: "", running: false, issueNumber: 7, url: "https://github.com/o/r/issues/7" },
    ]);
  });

  it("hold の waitFors は PR。running は false で、Issue が分からなければ issueNumber は null", () => {
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
    expect(source.queue[0].waitFors).toEqual([
      { kind: "pull", number: 20, title: "PR 20", running: false, issueNumber: null, url: "https://github.com/o/r/pull/20" },
    ]);
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

  it("目覚ましは寝ている実行（起きる時刻つき・番号の手がかり無し）。ほかの実行にはジョブの数", () => {
    const runs = [
      run({ id: 5, name: "Retry Timer", displayTitle: "やり直しの目覚まし 1795068487 #3", headBranch: "claude/issue-3-x" }),
      run({ id: 6, name: "Retry Timer", displayTitle: "やり直しの目覚まし 1795068487" }),
      run({ id: 7, name: "CI", headBranch: "claude/issue-3-x" }),
      run({ id: 8, name: "Watchdog" }),
    ];
    const source = buildLanesSource(
      [result(data({ issues: [issue(3, ["ai:implement"])], runs, runJobs: [{ runId: 7, inProgress: 9 }, { runId: 5, inProgress: 1 }] }))],
      NOW,
    );
    const byId = (id: number) => source.runs.find((entry) => entry.key === `o/r@${id}`);
    expect(byId(5)).toMatchObject({ sleeping: true, wakeAtMs: null, issueNumber: null, jobs: null });
    expect(byId(6)).toMatchObject({ sleeping: true, wakeAtMs: 1795068487000, issueNumber: null, jobs: null });
    expect(byId(7)).toMatchObject({ sleeping: false, wakeAtMs: null, issueNumber: 3, jobs: 9 });
    expect(byId(8)).toMatchObject({ sleeping: false, jobs: null });
  });

  it("動いている工場の実行は、番号の小さい `新サービス：` の Issue に結びつき、題名が真ん中に出る。同じ実行は1つだけ", () => {
    const factoryIssue = (number: number): IssueData => ({ ...issue(number), title: `新サービス：landing-page ${number}` });
    const source = buildLanesSource(
      [
        result(
          data({
            issues: [factoryIssue(30), factoryIssue(24)],
            runs: [run({ id: 9, name: "Factory talk", displayTitle: "Factory talk", startedAt: "2026-11-18T02:00:00Z" })],
          }),
        ),
      ],
      NOW,
    );
    expect(source.runs).toHaveLength(1);
    expect(source.runs[0]).toMatchObject({ issueNumber: 24, activity: "新サービス：landing-page 24" });
  });

  it("小さい番号が相談待ち（`factory:wait`）、大きい番号が作業中のとき、作業中の Issue に結びつく", () => {
    const factoryIssue = (number: number, labels: string[]): IssueData => ({
      ...issue(number),
      title: `新サービス：landing-page ${number}`,
      labels,
    });
    const source = buildLanesSource(
      [
        result(
          data({
            issues: [factoryIssue(19, ["factory:wait"]), factoryIssue(24, [])],
            runs: [run({ id: 9, name: "Factory talk", displayTitle: "Factory talk", startedAt: "2026-11-18T02:00:00Z" })],
          }),
        ),
      ],
      NOW,
    );
    expect(source.runs).toHaveLength(1);
    expect(source.runs[0]).toMatchObject({ issueNumber: 24, activity: "新サービス：landing-page 24" });
  });

  it("`新サービス：` の Issue が相談待ちだけのときは、工場の実行を Issue に結びつけない", () => {
    const source = buildLanesSource(
      [
        result(
          data({
            issues: [{ ...issue(19), title: "新サービス：landing-page 19", labels: ["factory:wait"] }],
            runs: [run({ id: 9, name: "Factory talk", displayTitle: "Factory talk" })],
          }),
        ),
      ],
      NOW,
    );
    expect(source.runs[0]).toMatchObject({ issueNumber: null, activity: "Factory talk" });
  });

  it("`新サービス：` の Issue が無いときは、工場の実行を Issue に結びつけない", () => {
    const source = buildLanesSource(
      [
        result(
          data({
            issues: [issue(24)],
            runs: [run({ id: 9, name: "Factory talk", displayTitle: "Factory talk" })],
          }),
        ),
      ],
      NOW,
    );
    expect(source.runs[0]).toMatchObject({ issueNumber: null, activity: "Factory talk" });
  });
});

describe("buildLanesSource：Paused（止めてある物）", () => {
  const mark = (body: string, author = "o"): CommentData => ({
    id: 9,
    issueNumber: 7,
    author,
    body,
    createdAt: "2026-11-18T01:13:00Z",
  });

  it("印のある ai:skip だけ入り、止めてからの時間の起点は印の時刻", () => {
    const source = buildLanesSource(
      [
        result(
          data({
            issues: [issue(7, ["ai:skip"]), issue(8, ["ai:skip"])],
            comments: [mark("<!-- paused: PR #510 のマージ待ち -->\n説明")],
          }),
        ),
      ],
      NOW,
    );
    expect(source.paused.map((p) => [p.number, p.reason, p.pausedAt])).toEqual([
      [7, "PR #510 のマージ待ち", Date.parse("2026-11-18T01:13:00Z")],
    ]);
  });

  it("ほかの人の印・ai:skip が外れた物は入らない", () => {
    const source = buildLanesSource(
      [
        result(data({ issues: [issue(7, ["ai:skip"])], comments: [mark("<!-- paused: X -->", "stranger")] })),
        result(data({ issues: [issue(7)], comments: [mark("<!-- paused: X -->")] }), "r2"),
      ],
      NOW,
    );
    expect(source.paused).toEqual([]);
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
    expect(runKind("Sync to apps")).toBe("Sync");
    expect(runKind("Resume")).toBe("Resume");
    expect(runKind("Visual Update")).toBe("Visual update");
    expect(runKind(undefined)).toBe("Actions");
  });

  it("モデル名を画面の名前に", () => {
    expect(modelLabel("claude-opus-5-5")).toBe("Opus");
    expect(modelLabel("sonnet")).toBe("Sonnet");
    expect(modelLabel("gpt")).toBe("gpt");
    expect(modelLabel(null)).toBeNull();
  });
});
