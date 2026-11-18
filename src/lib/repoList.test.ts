import { describe, expect, it } from "vitest";
import { formatLastActivity, sortRepoRows, type RepoListRow } from "./repoList";

function row(repo: string, turn: number, running: number, lastAt: string | null): RepoListRow {
  return { owner: "o", repo, turn, running, lastAt, githubUrl: "", links: [] };
}

describe("sortRepoRows", () => {
  it("あなたの番 → AIの番 → 最後に動いた時刻（新しい順）。時刻が無い物は最後", () => {
    const rows = [
      row("none", 0, 0, null),
      row("old", 0, 0, "2026-11-16T00:00:00Z"),
      row("ai", 0, 3, "2026-11-10T00:00:00Z"),
      row("many", 2, 0, "2026-11-01T00:00:00Z"),
      row("few", 1, 5, "2026-11-17T00:00:00Z"),
      row("new", 0, 0, "2026-11-17T00:00:00Z"),
    ];
    expect(sortRepoRows(rows).map((r) => r.repo)).toEqual(["many", "few", "ai", "new", "old", "none"]);
  });

  it("入力を変えない", () => {
    const rows = [row("b", 0, 0, null), row("a", 1, 0, null)];
    sortRepoRows(rows);
    expect(rows.map((r) => r.repo)).toEqual(["b", "a"]);
  });
});

describe("formatLastActivity", () => {
  const now = new Date("2026-11-18T03:00:00Z"); // 日本時間 11/18 12:00

  it("無ければ —", () => {
    expect(formatLastActivity(null, now)).toBe("—");
  });

  it("24時間以内は 3時間前 / 5分前", () => {
    expect(formatLastActivity("2026-11-18T00:00:00Z", now)).toBe("3時間前");
    expect(formatLastActivity("2026-11-18T02:55:00Z", now)).toBe("5分前");
  });

  it("今年は 11/17 09:07（日本時間）", () => {
    expect(formatLastActivity("2026-11-17T00:07:00Z", now)).toBe("11/17 09:07");
  });

  it("去年以前は年つき", () => {
    expect(formatLastActivity("2025-03-02T00:07:00Z", now)).toBe("2025/03/02 09:07");
  });
});
