import { describe, expect, it } from "vitest";
import type { IssueData, RepoResult } from "./github/types";
import { summarizeDriftIssues } from "./selfCheck";

function issue(number: number, title: string, createdAt: string, state: "open" | "closed" = "open"): IssueData {
  return {
    number,
    title,
    body: "",
    state,
    labels: [],
    url: `https://github.com/o/r/issues/${number}`,
    createdAt,
    updatedAt: createdAt,
    closedAt: state === "closed" ? createdAt : null,
  };
}

function result(issues: IssueData[], owner = "o", repo = "r"): RepoResult {
  return {
    owner,
    repo,
    ok: true,
    data: { issues, pulls: [], comments: [], pullChecks: {}, events: [] },
  };
}

describe("summarizeDriftIssues", () => {
  it("開いている表示のずれの Issue が無いと 0 件で URL は null", () => {
    expect(summarizeDriftIssues([])).toEqual({ count: 0, url: null });
    expect(summarizeDriftIssues([result([issue(1, "ボタンの色", "2026-11-19T01:00:00Z")])])).toEqual({
      count: 0,
      url: null,
    });
  });

  it("題名が「表示のずれ：」で始まる開いている Issue だけ数える", () => {
    const summary = summarizeDriftIssues([
      result([
        issue(1, "表示のずれ：ホームの札", "2026-11-19T01:00:00Z"),
        issue(2, "表示のずれ:半角のコロン", "2026-11-19T02:00:00Z"),
        issue(3, "ボタン：表示のずれ", "2026-11-19T03:00:00Z"),
        issue(4, "表示のずれ：閉じた物", "2026-11-19T04:00:00Z", "closed"),
      ]),
    ]);
    expect(summary.count).toBe(1);
  });

  it("複数のリポジトリを合わせて数え、いちばん新しい1件の URL を返す", () => {
    const summary = summarizeDriftIssues([
      result([issue(1, "表示のずれ：古い", "2026-11-18T00:00:00Z")], "a", "x"),
      result([issue(7, "表示のずれ：新しい", "2026-11-19T09:00:00Z")], "b", "y"),
      result([issue(3, "表示のずれ：中くらい", "2026-11-19T01:00:00Z")], "a", "z"),
    ]);
    expect(summary).toEqual({ count: 3, url: "https://github.com/o/r/issues/7" });
  });

  it("読めなかったリポジトリは数えない", () => {
    const summary = summarizeDriftIssues([
      { owner: "o", repo: "r", ok: false, error: { kind: "other", message: "x" } },
      result([issue(2, "表示のずれ：あり", "2026-11-19T00:00:00Z")]),
    ]);
    expect(summary.count).toBe(1);
  });
});
