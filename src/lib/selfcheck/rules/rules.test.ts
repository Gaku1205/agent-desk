import { describe, expect, it } from "vitest";
import type { IssueData, PullData, RepoData, RepoResult, WorkflowRunData } from "../../github/types";
import { runSelfcheck } from "../run";
import { buildScreen } from "../screen";
import type { Drift, OkResult, RuleInput, Screen, SelfcheckRule } from "../types";
import { aiWorking } from "./aiWorking";
import { allSections } from "./allSections";
import { SELFCHECK_RULES } from "./index";
import { slotsCount } from "./slotsCount";
import { unreadableHidden } from "./unreadableHidden";
import { yourTurnCount } from "./yourTurnCount";

const NOW = new Date("2026-11-19T12:00:00Z");
const OLD = "2026-11-19T08:00:00Z";

function issue(number: number, labels: string[], overrides: Partial<IssueData> = {}): IssueData {
  return {
    number,
    title: `Issue ${number}`,
    body: "",
    state: "open",
    labels,
    url: `https://github.com/o/r/issues/${number}`,
    createdAt: OLD,
    updatedAt: OLD,
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
    headRef: `claude/issue-${issueNumber}-20261119-0800`,
    headSha: `sha${number}`,
    mergeCommitSha: null,
    createdAt: OLD,
    updatedAt: OLD,
    mergedAt: null,
    ...overrides,
  };
}

function run(overrides: Partial<WorkflowRunData>): WorkflowRunData {
  return {
    id: 1,
    status: "in_progress",
    headBranch: null,
    displayTitle: "",
    pullNumbers: [],
    updatedAt: "2026-11-19T11:59:00Z",
    ...overrides,
  };
}

function repo(overrides: Partial<RepoData>): OkResult {
  return {
    owner: "o",
    repo: "r",
    ok: true,
    data: { issues: [], pulls: [], comments: [], pullChecks: {}, events: [], runs: [], ...overrides },
  };
}

const EMPTY_SCREEN: Screen = {
  turnItems: [],
  lanes: { works: [], queue: [], runs: [], paused: [] },
  messages: [],
  unreadableShown: 0,
};

function input(results: OkResult[], screen: Screen, unreadable: string[] = []): RuleInput {
  return { results, unreadable, now: NOW, screen };
}

function check(rule: SelfcheckRule, results: OkResult[], screen: Screen = buildScreen(results, NOW)): Drift[] {
  return rule.check(input(results, screen));
}

describe("all-sections", () => {
  const results = [
    repo({
      issues: [issue(3, ["ai:custom"]), issue(4, [])],
      pulls: [pull(9, 99, { body: "" , headRef: "claude/other-thing" })],
    }),
  ];

  it("どの区画にも出ていない ai:* の Issue と claude/ の PR を、番号つきで返す", () => {
    const drifts = check(allSections, results, EMPTY_SCREEN);
    expect(drifts.map((d) => [d.repo, d.number, d.rule])).toEqual([
      ["o/r", 3, "all-sections"],
      ["o/r", 9, "all-sections"],
    ]);
    expect(drifts[0].shown).toContain("どこにも出ていません");
    expect(drifts[0].actual).toContain("ai:custom");
    expect(drifts[1].actual).toContain("claude/other-thing");
  });

  it("画面に出ていれば返さない（ラベルの無い Issue は対象外）", () => {
    expect(check(allSections, results.slice(0, 1).map((r) => ({ ...r, data: { ...r.data, pulls: [] } })))).toEqual([]);
  });
});

describe("slots-count（#649 の形）", () => {
  const results = [repo({ issues: [issue(5, ["ai:implement"])] })];

  it("画面の側が正しければ返さない", () => {
    expect(check(slotsCount, results)).toEqual([]);
  });

  it("動いている作業があるのに Slots の使用中に入っていないと、ずれとして返す", () => {
    const screen = { ...buildScreen(results, NOW), lanes: { works: [], queue: [], runs: [], paused: [] } };
    const drifts = check(slotsCount, results, screen);
    expect(drifts).toEqual([
      {
        repo: "o/r",
        number: 5,
        rule: "slots-count",
        shown: "Slots の使用中は 0 件で、この作業は入っていません",
        actual: "動いている作業が 1 件あります（この Issue は implementing）",
      },
    ]);
  });
});

describe("your-turn-count（相談が来ているのに 0件）", () => {
  const results = [repo({ issues: [issue(7, ["factory:wait"])] })];

  it("画面の側が正しければ返さない", () => {
    expect(check(yourTurnCount, results)).toEqual([]);
  });

  it("工場の相談が来ているのに Your turn が 0件なら、ずれとして返す", () => {
    const drifts = check(yourTurnCount, results, EMPTY_SCREEN);
    expect(drifts).toEqual([
      {
        repo: "o/r",
        number: 7,
        rule: "your-turn-count",
        shown: "Your turn は 0件です",
        actual: "工場の相談に答えるのを待っています（factory:wait）",
      },
    ]);
  });

  it("止まった物・質問も人間の番として数える", () => {
    const stuck = [repo({ issues: [issue(1, ["ai:stuck"]), issue(2, ["ai:question"])] })];
    expect(check(yourTurnCount, stuck, EMPTY_SCREEN).map((d) => d.number).sort()).toEqual([1, 2]);
  });
});

describe("ai-working（作業中なのに相談待ち・実行が無いのに作業中）", () => {
  it("作業中と出しているのに、動いている実行が無く30分以上たっていれば返す", () => {
    const results = [repo({ issues: [issue(5, ["ai:implement"])], runs: [] })];
    const drifts = check(aiWorking, results);
    expect(drifts).toHaveLength(1);
    expect(drifts[0]).toMatchObject({ repo: "o/r", number: 5, rule: "ai-working" });
    expect(drifts[0].shown).toContain("AI が作業中");
    expect(drifts[0].actual).toContain("動いている Actions の実行がありません");
  });

  it("動いている実行がある・更新が30分以内・実行を取れていないときは返さない", () => {
    const running = [repo({ issues: [issue(5, ["ai:implement"])], runs: [run({ headBranch: "claude/issue-5-x" })] })];
    expect(check(aiWorking, running)).toEqual([]);
    const recent = [repo({ issues: [issue(5, ["ai:implement"], { updatedAt: "2026-11-19T11:50:00Z" })], runs: [] })];
    expect(check(aiWorking, recent)).toEqual([]);
    const unknown = [repo({ issues: [issue(5, ["ai:implement"])], runs: null })];
    expect(check(aiWorking, unknown)).toEqual([]);
  });

  it("実行が動いているのに工場の相談待ちと出していれば返す", () => {
    const results = [
      repo({ issues: [issue(7, ["factory:wait"])], runs: [run({ displayTitle: "Factory talk #7", name: "Factory" })] }),
    ];
    const drifts = check(aiWorking, results);
    expect(drifts).toEqual([
      {
        repo: "o/r",
        number: 7,
        rule: "ai-working",
        shown: "Your turn で工場の相談待ちと出ています",
        actual: "Actions の実行が動いています（Factory）",
      },
    ]);
  });
});

describe("unreadable-hidden（#612 の形）", () => {
  it("読めなかったリポジトリがあるのに、画面が出していなければ返す", () => {
    const drifts = unreadableHidden.check(input([], EMPTY_SCREEN, ["o/broken"]));
    expect(drifts).toHaveLength(1);
    expect(drifts[0]).toMatchObject({ repo: "o/broken", number: 0, rule: "unreadable-hidden" });
  });

  it("画面が読めなかった行を出している・読めない物が無いときは返さない", () => {
    expect(unreadableHidden.check(input([], { ...EMPTY_SCREEN, unreadableShown: 1 }, ["o/broken"]))).toEqual([]);
    expect(unreadableHidden.check(input([], EMPTY_SCREEN, []))).toEqual([]);
  });
});

describe("runSelfcheck", () => {
  it("決まりの名前は5つの英字で、並べて足していける", () => {
    expect(SELFCHECK_RULES.map((rule) => rule.name)).toEqual([
      "all-sections",
      "slots-count",
      "your-turn-count",
      "ai-working",
      "unreadable-hidden",
    ]);
  });

  it("読めなかったリポジトリを unreadable に入れ、画面の側が正しければ drifts は空", () => {
    const broken: RepoResult = {
      owner: "o",
      repo: "broken",
      ok: false,
      error: { kind: "other", message: "x" },
    };
    const report = runSelfcheck([repo({ issues: [issue(5, ["ai:implement"])], runs: [run({ headBranch: "claude/issue-5-x" })] }), broken], NOW);
    expect(report.repoCount).toBe(2);
    expect(report.unreadable).toEqual(["o/broken"]);
    expect(report.drifts).toEqual([]);
    expect(report.checkedAt).toBe(NOW.toISOString());
  });
});
