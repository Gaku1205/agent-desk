"use server";

import { refresh } from "next/cache";
import { getGitHubToken, getSignedInLogin } from "@/lib/auth";
import { findWatchedRepo, getAllowedLogins, getSettingsRepo } from "@/lib/config";
import {
  checkNotifyEvents,
  formatNotifyEvents,
  NOTIFY_EVENTS_VARIABLE,
  NOTIFY_MESSAGES,
} from "@/lib/notifyEvents";
import { loadWatchedRepos } from "@/lib/watchedRepos";
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

/** あるリポジトリの「鳴らす通知の種類」を、そのリポジトリの Variable `NOTIFY_EVENTS` に保存する */
export async function saveNotifyEvents(repo: unknown, events: unknown): Promise<SaveReposResult> {
  const login = await getSignedInLogin();
  const token = await getGitHubToken();
  if (!token || !isAllowedLogin(login, getAllowedLogins())) {
    return { ok: false, message: REPO_SETTING_MESSAGES.unauthorized };
  }
  const parsed = typeof repo === "string" ? parseRepoName(repo) : null;
  if (!parsed) return { ok: false, message: REPO_SETTING_MESSAGES.invalid };
  const checked = checkNotifyEvents(events);
  if (!checked.ok) return checked;

  // 監視しているリポジトリ以外には書かない
  const target = findWatchedRepo(parsed.owner, parsed.repo, (await loadWatchedRepos()).repos);
  if (!target) return { ok: false, message: REPO_SETTING_MESSAGES.invalid };

  const client = new GitHubClient(token);
  try {
    if (!(await hasPipeline(client, target))) {
      return { ok: false, message: NOTIFY_MESSAGES.noPipeline };
    }
    await writeVariable(client, target, NOTIFY_EVENTS_VARIABLE, formatNotifyEvents(checked.events));
  } catch (error) {
    return { ok: false, message: repoSettingErrorMessage(error) };
  }
  return { ok: true };
}
