import { describe, expect, it } from "vitest";
import { parseSavedRepos, reposToShow } from "./savedRepos";

describe("parseSavedRepos", () => {
  it("`owner/repo` の並びを読む（重複は1つにする）", () => {
    expect(parseSavedRepos(["o/a", "o/b", "O/A"])).toEqual([
      { owner: "o", repo: "a" },
      { owner: "o", repo: "b" },
    ]);
  });

  it("形が違う・空の物は null", () => {
    expect(parseSavedRepos("o/a")).toBeNull();
    expect(parseSavedRepos(["o/a", 1])).toBeNull();
    expect(parseSavedRepos(["no-slash"])).toBeNull();
    expect(parseSavedRepos([])).toBeNull();
    expect(parseSavedRepos(null)).toBeNull();
  });
});

describe("reposToShow", () => {
  const base = [{ owner: "o", repo: "a" }];
  const saved = [{ owner: "o", repo: "a" }, { owner: "o", repo: "b" }];

  it("保存した一覧が無ければ、サーバーの一覧", () => {
    expect(reposToShow(base, null)).toBe(base);
  });

  it("保存した直後（サーバーの一覧がそのまま）は、保存した一覧", () => {
    expect(reposToShow(base, { repos: saved, base })).toBe(saved);
  });

  it("サーバーの一覧が新しくなったら、サーバーの一覧（保存した一覧は役目を終える）", () => {
    const refreshed = [...saved];
    expect(reposToShow(refreshed, { repos: saved, base })).toBe(refreshed);
  });
});
