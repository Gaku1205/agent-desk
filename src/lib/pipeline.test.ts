import { describe, expect, it } from "vitest";
import type { IssueData, PullData, RepoData } from "./github/types";
import {
  buildPipelineRows,
  deployedMoreLabel,
  filterPipelineRows,
  getPipelineView,
  showMoreDeployed,
  type PipelineRow,
} from "./pipeline";

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

describe("buildPipelineRows", () => {
  it("Issue番号が大きい順に並べる", () => {
    const rows = buildPipelineRows(data({ issues: [issue(2), issue(9), issue(5)] }), NOW);
    expect(rows.map((row) => row.issue.number)).toEqual([9, 5, 2]);
  });

  it("段階が変わっても行の順番は変わらない", () => {
    const before = data({ issues: [issue(1), issue(2), issue(3)] });
    const after = data({
      issues: [issue(1, { labels: ["ai:stuck"] }), issue(2, { labels: ["ai:implement"] }), issue(3)],
    });
    const order = (d: RepoData) => buildPipelineRows(d, NOW).map((row) => row.issue.number);
    expect(order(after)).toEqual(order(before));
    expect(buildPipelineRows(after, NOW).map((row) => row.status.stage)).toEqual([
      "notStarted",
      "implementing",
      "stuck",
    ]);
  });

  it("表示しないIssue（マージ済みでない閉じたIssue）は出さない", () => {
    const rows = buildPipelineRows(data({ issues: [issue(1), issue(2, { state: "closed" })] }), NOW);
    expect(rows.map((row) => row.issue.number)).toEqual([1]);
  });

  it("閉じていてもマージ済みなら出す。公開済みの進み具合を持つ", () => {
    const pull: PullData = {
      number: 12,
      title: "PR",
      body: "Closes #3",
      state: "closed",
      merged: true,
      labels: [],
      url: "https://github.com/o/r/pull/12",
      headRef: "claude/issue-3-x",
      headSha: "a",
      mergeCommitSha: "m",
      createdAt: "2026-10-25T09:00:00Z",
      updatedAt: "2026-10-25T09:30:00Z",
      mergedAt: "2026-10-25T09:30:00Z",
    };
    const rows = buildPipelineRows(
      data({
        issues: [issue(3, { state: "closed" })],
        pulls: [pull],
        pullChecks: { 12: { checkRuns: [], statuses: [] } },
      }),
      NOW,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].status.stage).toBe("deployed");
    expect(rows[0].progress.ariaLabel).toBe("進み具合 8/8・公開済み");
  });

  it("0件なら空", () => {
    expect(buildPipelineRows(data(), NOW)).toEqual([]);
  });
});

describe("filterPipelineRows", () => {
  function row(number: number, stage: string): PipelineRow {
    const title = "Issue " + number;
    return { issue: { number, title, url: "" }, status: { stage } } as unknown as PipelineRow;
  }
  const mixed = [row(4, "deployed"), row(3, "ci"), row(2, "deployed"), row(1, "notStarted")];

  it("隠すときは公開済み以外だけを、並び順を保って返す", () => {
    expect(filterPipelineRows(mixed, false).map((r) => r.issue.number)).toEqual([3, 1]);
  });

  it("出すときはすべてを同じ順で返す", () => {
    expect(filterPipelineRows(mixed, true).map((r) => r.issue.number)).toEqual([4, 3, 2, 1]);
  });

  it("公開済みしかなければ、隠すと空になる", () => {
    expect(filterPipelineRows([row(2, "deployed"), row(1, "deployed")], false)).toEqual([]);
  });

  it("空配列は空配列のまま", () => {
    expect(filterPipelineRows([], false)).toEqual([]);
    expect(filterPipelineRows([], true)).toEqual([]);
  });
});

describe("公開済みの段階表示", () => {
  function row(number: number, stage: string): PipelineRow {
    return { issue: { number, title: "", url: "" }, status: { stage } } as unknown as PipelineRow;
  }
  const deployed = (from: number, count: number) =>
    Array.from({ length: count }, (_, i) => row(from - i, "deployed"));
  const numbers = (rows: PipelineRow[]) => rows.map((r) => r.issue.number);

  it("最初は公開済みを出さない", () => {
    const view = getPipelineView([row(30, "implementing"), ...deployed(20, 19)], 0);
    expect(numbers(view.rows)).toEqual([30]);
    expect(view.deployedTotal).toBe(19);
    expect(view.deployedRemaining).toBe(19);
    expect(deployedMoreLabel(view)).toBe("公開済みを表示（19件）");
  });

  it("公開済みは新しい順に件数分だけ、未完了の下に並ぶ", () => {
    const rows = [row(30, "implementing"), row(25, "deployed"), row(22, "queued"), ...deployed(20, 6)];
    const view = getPipelineView(rows, 5);
    expect(numbers(view.rows)).toEqual([30, 22, 25, 20, 19, 18, 17]);
    expect(view.deployedRemaining).toBe(2);
    expect(deployedMoreLabel(view)).toBe("さらに5件表示（残り2件）");
  });

  it("押すたびに5件ずつ増え、総数で止まる", () => {
    expect(showMoreDeployed(0, 19)).toBe(5);
    expect(showMoreDeployed(15, 19)).toBe(19);
    expect(showMoreDeployed(19, 19)).toBe(19);
  });

  it("全部出したら「さらに」は出ない", () => {
    const view = getPipelineView(deployed(10, 3), 5);
    expect(view.deployedShown).toBe(3);
    expect(view.deployedRemaining).toBe(0);
    expect(deployedMoreLabel(view)).toBeNull();
  });

  it("公開済みが0件なら総数も0", () => {
    const view = getPipelineView([row(1, "implementing")], 0);
    expect(view.deployedTotal).toBe(0);
    expect(deployedMoreLabel(view)).toBeNull();
  });
});
