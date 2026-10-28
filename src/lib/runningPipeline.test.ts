import { describe, expect, it } from "vitest";
import type { IssueData, PullData, RepoData, RepoResult } from "./github/types";
import { buildRunningPipelineRows, isRunningStage } from "./runningPipeline";
import type { Stage } from "./status";

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
    title: "PR",
    body: `Closes #${issueNumber}`,
    state: "open",
    merged: false,
    labels: [],
    url: `https://github.com/o/r/pull/${number}`,
    headRef: `claude/issue-${issueNumber}-x`,
    headSha: `h${number}`,
    mergeCommitSha: null,
    createdAt: "2026-10-25T10:00:00Z",
    updatedAt: "2026-10-25T10:00:00Z",
    mergedAt: null,
    ...overrides,
  };
}

function data(overrides: Partial<RepoData> = {}): RepoData {
  return { issues: [], pulls: [], comments: [], pullChecks: {}, events: [], ...overrides };
}

function ok(owner: string, repo: string, repoData: RepoData): RepoResult {
  return { owner, repo, ok: true, data: repoData };
}

describe("isRunningStage", () => {
  it("AIの番で動いている段階だけ true", () => {
    const running: Stage[] = ["planning", "implementing", "ciRunning", "reviewing", "fixing", "deploying"];
    const others: Stage[] = [
      "stuck",
      "deployed",
      "deployFailed",
      "mergeWaiting",
      "ciFailed",
      "prWaiting",
      "queued",
      "notStarted",
    ];
    for (const stage of running) expect(isRunningStage(stage)).toBe(true);
    for (const stage of others) expect(isRunningStage(stage)).toBe(false);
  });
});

describe("buildRunningPipelineRows", () => {
  it("AIの番の作業だけを出し、あなたの番・順番待ち・止まった物・公開済みは出さない", () => {
    const merged = pull(30, 6, {
      state: "closed",
      merged: true,
      mergeCommitSha: "m30",
      mergedAt: "2026-10-25T11:50:00Z",
    });
    const deployed = pull(31, 7, {
      state: "closed",
      merged: true,
      mergeCommitSha: "m31",
      mergedAt: "2026-10-25T09:00:00Z",
    });
    const rows = buildRunningPipelineRows(
      [
        ok(
          "o",
          "r",
          data({
            issues: [
              issue(1),
              issue(2, { labels: ["ai:plan"] }),
              issue(3, { labels: ["ai:implement"] }),
              issue(4, { labels: ["ai:queue"] }),
              issue(5, { labels: ["ai:implement", "ai:stuck"] }),
              issue(6, { state: "closed" }),
              issue(7, { state: "closed" }),
              issue(8, { labels: ["ai:implement"] }),
            ],
            pulls: [merged, deployed, pull(32, 8)],
            pullChecks: {
              30: { checkRuns: [], statuses: [] },
              31: {
                checkRuns: [],
                statuses: [
                  { context: "Vercel", state: "success", description: "", updatedAt: "2026-10-25T09:05:00Z" },
                ],
              },
              32: { checkRuns: [], statuses: [] },
            },
          }),
        ),
      ],
      NOW,
    );
    expect(rows.map((row) => [row.issue.number, row.status.stage])).toEqual([
      [8, "ciRunning"],
      [6, "deploying"],
      [3, "implementing"],
      [2, "planning"],
    ]);
  });

  it("全リポジトリをまとめて、Issue番号が大きい順に並べる。どのリポジトリの物かを持つ", () => {
    const rows = buildRunningPipelineRows(
      [
        ok("o", "a", data({ issues: [issue(2, { labels: ["ai:plan"] }), issue(9, { labels: ["ai:plan"] })] })),
        ok("o", "b", data({ issues: [issue(5, { labels: ["ai:implement"] }), issue(9, { labels: ["ai:plan"] })] })),
      ],
      NOW,
    );
    expect(rows.map((row) => `${row.owner}/${row.repo}#${row.issue.number}`)).toEqual([
      "o/a#9",
      "o/b#9",
      "o/b#5",
      "o/a#2",
    ]);
  });

  it("取れなかったリポジトリは飛ばす", () => {
    const rows = buildRunningPipelineRows(
      [
        { owner: "o", repo: "x", ok: false, error: { kind: "not_found", message: "見つかりません" } },
        ok("o", "r", data({ issues: [issue(1, { labels: ["ai:plan"] })] })),
      ],
      NOW,
    );
    expect(rows.map((row) => row.repo)).toEqual(["r"]);
  });

  it("動いている物が無ければ空", () => {
    expect(buildRunningPipelineRows([ok("o", "r", data({ issues: [issue(1)] }))], NOW)).toEqual([]);
    expect(buildRunningPipelineRows([], NOW)).toEqual([]);
  });
});
