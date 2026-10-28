import { describe, expect, it } from "vitest";
import type { IssueData, RepoData, RepoResult } from "./github/types";
import { buildRunningPipelineRows } from "./runningPipeline";
import type { Stage } from "./status";
import { buildWaitingPipelineRows, isWaitingStage } from "./waitingPipeline";

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

function data(overrides: Partial<RepoData> = {}): RepoData {
  return { issues: [], pulls: [], comments: [], pullChecks: {}, events: [], ...overrides };
}

function ok(owner: string, repo: string, repoData: RepoData): RepoResult {
  return { owner, repo, ok: true, data: repoData };
}

describe("isWaitingStage", () => {
  it("順番待ちとやり直し待ちだけ true", () => {
    const others: Stage[] = ["planning", "implementing", "ciRunning", "reviewing", "fixing", "deploying", "stuck", "notStarted"];
    expect(isWaitingStage("queued")).toBe(true);
    expect(isWaitingStage("retrying")).toBe(true);
    for (const stage of others) expect(isWaitingStage(stage)).toBe(false);
  });
});

describe("buildWaitingPipelineRows", () => {
  const results = [
    ok(
      "o",
      "r",
      data({
        issues: [
          issue(1),
          issue(2, { labels: ["ai:queue"], updatedAt: "2026-10-25T10:00:00Z" }),
          issue(3, { labels: ["ai:implement", "ai:retry"], updatedAt: "2026-10-25T08:00:00Z" }),
          issue(4, { labels: ["ai:implement"] }),
          issue(5, { labels: ["ai:implement", "ai:stuck"] }),
        ],
      }),
    ),
  ];

  it("順番待ちとやり直し待ちだけを出し、実行中には出ない", () => {
    const rows = buildWaitingPipelineRows(results, NOW);
    expect(rows.map((row) => [row.issue.number, row.status.stage])).toEqual([
      [3, "retrying"],
      [2, "queued"],
    ]);
    const running = buildRunningPipelineRows(results, NOW).map((row) => row.issue.number);
    for (const row of rows) expect(running).not.toContain(row.issue.number);
  });

  it("待っている時間が長い順（updatedAt の古い順）。同じ時刻ならIssue番号の小さい順、次にリポジトリ名の順", () => {
    const same = "2026-10-25T10:00:00Z";
    const rows = buildWaitingPipelineRows(
      [
        ok("o", "b", data({ issues: [issue(7, { labels: ["ai:queue"], updatedAt: same })] })),
        ok(
          "o",
          "a",
          data({
            issues: [
              issue(9, { labels: ["ai:queue"], updatedAt: same }),
              issue(7, { labels: ["ai:queue"], updatedAt: same }),
              issue(20, { labels: ["ai:queue"], updatedAt: "2026-10-24T10:00:00Z" }),
            ],
          }),
        ),
      ],
      NOW,
    );
    expect(rows.map((row) => `${row.repo}#${row.issue.number}`)).toEqual(["a#20", "a#7", "b#7", "a#9"]);
  });

  it("どのリポジトリの物かを持ち、取れなかったリポジトリは飛ばす", () => {
    const rows = buildWaitingPipelineRows(
      [
        { owner: "o", repo: "x", ok: false, error: { kind: "not_found", message: "見つかりません" } } as RepoResult,
        ok("o", "r", data({ issues: [issue(2, { labels: ["ai:queue"] })] })),
      ],
      NOW,
    );
    expect(rows.map((row) => [row.owner, row.repo, row.issue.number])).toEqual([["o", "r", 2]]);
  });

  it("待っている物が無ければ空", () => {
    expect(buildWaitingPipelineRows([], NOW)).toEqual([]);
  });
});
