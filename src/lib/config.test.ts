import { describe, expect, it } from "vitest";
import {
  chooseWatchedRepos,
  findWatchedRepo,
  getAllowedLogins,
  getSettingsRepo,
  getWatchedRepos,
} from "./config";

describe("getWatchedRepos", () => {
  it("カンマ区切りの owner/repo を読む", () => {
    expect(
      getWatchedRepos({ WATCHED_REPOS: "Gaku1205/agent-desk, Gaku1205/ai-dev-template" }),
    ).toEqual([
      { owner: "Gaku1205", repo: "agent-desk" },
      { owner: "Gaku1205", repo: "ai-dev-template" },
    ]);
  });

  it("未設定・空なら空の配列", () => {
    expect(getWatchedRepos({})).toEqual([]);
    expect(getWatchedRepos({ WATCHED_REPOS: "" })).toEqual([]);
    expect(getWatchedRepos({ WATCHED_REPOS: " , " })).toEqual([]);
  });

  it("形の合わないものは捨てる", () => {
    expect(
      getWatchedRepos({ WATCHED_REPOS: "agent-desk,a/b/c,/repo,owner/,ok/repo" }),
    ).toEqual([{ owner: "ok", repo: "repo" }]);
  });

  it("大文字小文字だけ違う重複は最初のものを残す", () => {
    expect(
      getWatchedRepos({ WATCHED_REPOS: "Gaku1205/agent-desk,gaku1205/Agent-Desk" }),
    ).toEqual([{ owner: "Gaku1205", repo: "agent-desk" }]);
  });
});

describe("chooseWatchedRepos", () => {
  const env = { WATCHED_REPOS: "Gaku1205/agent-desk" };

  it("Variable があればそれを使う", () => {
    expect(chooseWatchedRepos("Gaku1205/ai-dev-template,Gaku1205/other", env)).toEqual({
      repos: [
        { owner: "Gaku1205", repo: "ai-dev-template" },
        { owner: "Gaku1205", repo: "other" },
      ],
      source: "variable",
    });
  });

  it("Variable が無い・形の合う物が無ければ WATCHED_REPOS を使う", () => {
    const fromEnv = { repos: [{ owner: "Gaku1205", repo: "agent-desk" }], source: "env" };
    expect(chooseWatchedRepos(null, env)).toEqual(fromEnv);
    expect(chooseWatchedRepos("", env)).toEqual(fromEnv);
    expect(chooseWatchedRepos("bad,a/b/c", env)).toEqual(fromEnv);
  });
});

describe("getSettingsRepo", () => {
  it("owner/repo を読む", () => {
    expect(getSettingsRepo({ SETTINGS_REPO: " Gaku1205/agent-desk " })).toEqual({
      owner: "Gaku1205",
      repo: "agent-desk",
    });
  });

  it("無い・形が合わなければ null", () => {
    expect(getSettingsRepo({})).toBeNull();
    expect(getSettingsRepo({ SETTINGS_REPO: "" })).toBeNull();
    expect(getSettingsRepo({ SETTINGS_REPO: "agent-desk" })).toBeNull();
    expect(getSettingsRepo({ SETTINGS_REPO: "a/b,c/d" })).toBeNull();
  });
});

describe("getAllowedLogins", () => {
  it("カンマ区切りを小文字にそろえて読む", () => {
    expect(getAllowedLogins({ ALLOWED_GITHUB_LOGINS: "Gaku1205, octocat" })).toEqual([
      "gaku1205",
      "octocat",
    ]);
  });

  it("未設定・空なら空の配列", () => {
    expect(getAllowedLogins({})).toEqual([]);
    expect(getAllowedLogins({ ALLOWED_GITHUB_LOGINS: " ,," })).toEqual([]);
  });

  it("重複は1つにする", () => {
    expect(getAllowedLogins({ ALLOWED_GITHUB_LOGINS: "a,A,a" })).toEqual(["a"]);
  });
});

describe("findWatchedRepo", () => {
  const watched = [{ owner: "Gaku1205", repo: "agent-desk" }];

  it("大文字小文字を問わず見つけ、設定の表記で返す", () => {
    expect(findWatchedRepo("gaku1205", "AGENT-DESK", watched)).toEqual({
      owner: "Gaku1205",
      repo: "agent-desk",
    });
  });

  it("監視していなければ undefined", () => {
    expect(findWatchedRepo("Gaku1205", "other", watched)).toBeUndefined();
    expect(findWatchedRepo("someone", "agent-desk", watched)).toBeUndefined();
  });
});
