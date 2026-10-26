import { describe, expect, it } from "vitest";
import { GitHubError } from "./github/errors";
import {
  authorizeRepoSetting,
  checkRepoList,
  findUnlisted,
  formatRepoList,
  parseRepoName,
  REPO_SETTING_MESSAGES,
  repoSettingErrorMessage,
} from "./repoSetting";

describe("parseRepoName", () => {
  it("owner/repo を読む", () => {
    expect(parseRepoName(" Gaku1205/agent-desk ")).toEqual({
      owner: "Gaku1205",
      repo: "agent-desk",
    });
  });

  it("形の合わない物は null", () => {
    for (const value of ["agent-desk", "a/b/c", "/repo", "owner/", "a b/c", "a/..", "a/../b"]) {
      expect(parseRepoName(value)).toBeNull();
    }
  });
});

describe("checkRepoList", () => {
  it("重複（大文字小文字だけ違う物も）は最初の物を残す", () => {
    expect(
      checkRepoList(["Gaku1205/agent-desk", "gaku1205/Agent-Desk", "Gaku1205/ai-dev-template"]),
    ).toEqual({
      ok: true,
      repos: [
        { owner: "Gaku1205", repo: "agent-desk" },
        { owner: "Gaku1205", repo: "ai-dev-template" },
      ],
    });
  });

  it("0件は保存できない", () => {
    expect(checkRepoList([])).toEqual({ ok: false, message: REPO_SETTING_MESSAGES.empty });
  });

  it("owner/repo の形でない物が1つでもあれば保存できない", () => {
    expect(checkRepoList(["Gaku1205/agent-desk", "agent-desk"])).toEqual({
      ok: false,
      message: REPO_SETTING_MESSAGES.invalid,
    });
    expect(checkRepoList(["a/b,c/d"])).toEqual({
      ok: false,
      message: REPO_SETTING_MESSAGES.invalid,
    });
  });

  it("文字列の配列でなければ保存できない", () => {
    for (const value of [null, "a/b", { 0: "a/b" }, [1], ["a/b", null]]) {
      expect(checkRepoList(value)).toEqual({ ok: false, message: REPO_SETTING_MESSAGES.invalid });
    }
  });
});

describe("findUnlisted", () => {
  it("読めるリポジトリの一覧に無い物を、大文字小文字を問わず探す", () => {
    const repos = [
      { owner: "Gaku1205", repo: "agent-desk" },
      { owner: "someone", repo: "secret" },
    ];
    expect(findUnlisted(repos, ["gaku1205/AGENT-DESK"])).toEqual([
      { owner: "someone", repo: "secret" },
    ]);
  });
});

describe("formatRepoList", () => {
  it("カンマ区切りにする", () => {
    expect(
      formatRepoList([
        { owner: "a", repo: "b" },
        { owner: "c", repo: "d" },
      ]),
    ).toBe("a/b,c/d");
  });
});

describe("authorizeRepoSetting", () => {
  const settingsRepo = { owner: "Gaku1205", repo: "agent-desk" };
  const base = { login: "Gaku1205", token: "t", allowedLogins: ["gaku1205"], settingsRepo };

  it("許可リストのユーザーで SETTINGS_REPO があれば通す", () => {
    expect(authorizeRepoSetting(base)).toEqual({ ok: true, token: "t", settingsRepo });
  });

  it("許可リスト外・トークン無しは通さない", () => {
    expect(authorizeRepoSetting({ ...base, login: "other" })).toEqual({
      ok: false,
      message: REPO_SETTING_MESSAGES.unauthorized,
    });
    expect(authorizeRepoSetting({ ...base, token: null })).toEqual({
      ok: false,
      message: REPO_SETTING_MESSAGES.unauthorized,
    });
  });

  it("SETTINGS_REPO が無ければ変えられない", () => {
    expect(authorizeRepoSetting({ ...base, settingsRepo: null })).toEqual({
      ok: false,
      message: REPO_SETTING_MESSAGES.noSettingsRepo,
    });
  });
});

describe("repoSettingErrorMessage", () => {
  it("権限が無い（403・404）ときは、設定を変える権限が無いと出す", () => {
    expect(repoSettingErrorMessage(new GitHubError("forbidden", 403))).toBe(
      "このリポジトリの設定を変える権限がありません",
    );
    expect(repoSettingErrorMessage(new GitHubError("not_found", 404))).toBe(
      REPO_SETTING_MESSAGES.forbidden,
    );
  });

  it("それ以外", () => {
    expect(repoSettingErrorMessage(new GitHubError("unauthorized", 401))).toBe(
      REPO_SETTING_MESSAGES.unauthorized,
    );
    expect(repoSettingErrorMessage(new GitHubError("rate_limited", 429))).toBe(
      REPO_SETTING_MESSAGES.rateLimited,
    );
    expect(repoSettingErrorMessage(new Error("x"))).toBe(REPO_SETTING_MESSAGES.failed);
  });
});
