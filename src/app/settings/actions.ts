"use server";

import { refresh } from "next/cache";
import { getGitHubToken, getSignedInLogin } from "@/lib/auth";
import { getAllowedLogins, getSettingsRepo } from "@/lib/config";
import { GitHubClient } from "@/lib/github/client";
import {
  canReadRepo,
  hasPipeline,
  listReadableRepos,
  WATCHED_REPOS_VARIABLE,
  writeVariable,
} from "@/lib/github/settings";
import { isAllowedLogin } from "@/lib/allowlist";
import {
  authorizeRepoSetting,
  checkRepoList,
  findUnlisted,
  formatRepoList,
  parseRepoName,
  REPO_SETTING_MESSAGES,
  repoSettingErrorMessage,
} from "@/lib/repoSetting";

export type SaveReposResult = { ok: true } | { ok: false; message: string };

/** 「監視するリポジトリ」を `SETTINGS_REPO` の Variable に保存する。トークンはサーバー側だけで使う */
export async function saveWatchedRepos(value: unknown): Promise<SaveReposResult> {
  const auth = authorizeRepoSetting({
    login: await getSignedInLogin(),
    token: await getGitHubToken(),
    allowedLogins: getAllowedLogins(),
    settingsRepo: getSettingsRepo(),
  });
  if (!auth.ok) return auth;

  const checked = checkRepoList(value);
  if (!checked.ok) return checked;

  const client = new GitHubClient(auth.token);
  try {
    // 一覧（最大500件）に無い物は、1件ずつ読めるか確かめる
    const unlisted = findUnlisted(checked.repos, await listReadableRepos(client));
    for (const repo of unlisted) {
      if (!(await canReadRepo(client, repo))) {
        return { ok: false, message: REPO_SETTING_MESSAGES.unreadable };
      }
    }
    await writeVariable(
      client,
      auth.settingsRepo,
      WATCHED_REPOS_VARIABLE,
      formatRepoList(checked.repos),
    );
  } catch (error) {
    return { ok: false, message: repoSettingErrorMessage(error) };
  }
  refresh();
  return { ok: true };
}

/** 追加の欄で選んだリポジトリに、全自動パイプラインがあるか。調べられなければ null */
export async function checkPipeline(value: unknown): Promise<boolean | null> {
  if (typeof value !== "string") return null;
  const target = parseRepoName(value);
  const login = await getSignedInLogin();
  const token = await getGitHubToken();
  if (!target || !token || !isAllowedLogin(login, getAllowedLogins())) return null;
  return hasPipeline(new GitHubClient(token), target);
}
