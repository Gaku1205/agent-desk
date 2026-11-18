import { describe, expect, it } from "vitest";
import type { TurnCounts } from "./turn";
import { currentRepoFromPath, visibleRepos } from "./visibleRepos";

const repos = [
  { owner: "o", repo: "a" },
  { owner: "o", repo: "b" },
  { owner: "o", repo: "c" },
  { owner: "o", repo: "d" },
];
const turn: TurnCounts = { total: 1, byRepo: { "o/a": 1 } };
const running: TurnCounts = { total: 2, byRepo: { "o/c": 2, "o/d": 0 } };

describe("visibleRepos", () => {
  it("あなたの番かAIの番が1件以上の物だけを、入力の並びのまま返す", () => {
    expect(visibleRepos(repos, turn, running, null).map((r) => r.repo)).toEqual(["a", "c"]);
  });

  it("今開いているリポジトリは 0・0 でも出す（大文字小文字は区別しない）", () => {
    expect(visibleRepos(repos, turn, running, { owner: "O", repo: "D" }).map((r) => r.repo)).toEqual(["a", "c", "d"]);
  });

  it("全部が 0・0 なら空", () => {
    const zero: TurnCounts = { total: 0, byRepo: {} };
    expect(visibleRepos(repos, zero, zero, null)).toEqual([]);
  });
});

describe("currentRepoFromPath", () => {
  it("リポジトリのページを読む（デモも）", () => {
    expect(currentRepoFromPath("/repos/o/a")).toEqual({ owner: "o", repo: "a" });
    expect(currentRepoFromPath("/demo/repos/demo/todo-app/")).toEqual({ owner: "demo", repo: "todo-app" });
  });

  it("一覧・ホーム・ほかのページは null", () => {
    expect(currentRepoFromPath("/repos")).toBeNull();
    expect(currentRepoFromPath("/demo/repos")).toBeNull();
    expect(currentRepoFromPath("/")).toBeNull();
    expect(currentRepoFromPath("/settings")).toBeNull();
  });
});
