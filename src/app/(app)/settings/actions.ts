"use server";

import { refresh, updateTag } from "next/cache";
import { getGitHubToken, getSignedInLogin } from "@/lib/auth";
import { formatAutoAddEnabled, updateRemovedRepos } from "@/lib/autoAdd";
import {
  chooseWatchedRepos,
  findWatchedRepo,
  getAllowedLogins,
  getSettingsRepo,
  parseRepoList,
} from "@/lib/config";
import { AUTO_ADD_VARIABLE, REMOVED_REPOS_VARIABLE } from "@/lib/github/autoAdd";
import {
  checkNotifyEvents,
  formatNotifyEvents,
  NOTIFY_EVENTS_VARIABLE,
  NOTIFY_MESSAGES,
} from "@/lib/notifyEvents";
import { loadWatchedRepos } from "@/lib/watchedRepos";
import { GitHubClient } from "@/lib/github/client";
import { WATCHED_REPOS_TAG } from "@/lib/github/repoCache";
import {
  canReadRepo,
  deleteVariable,
  hasPipeline,
  listReadableRepos,
  readParallelOverride,
  readParallelSettings,
  readVariable,
  WATCHED_REPOS_VARIABLE,
  writeParallelOverride,
  writeParallelSettings,
  writeVariable,
} from "@/lib/github/settings";
import {
  checkParallelSettings,
  DEFAULT_PARALLEL_SETTINGS,
  formatParallelOverride,
  nextPeriodSwitch,
  PARALLEL_MESSAGES,
  type ParallelSettings,
} from "@/lib/parallel";
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
    // 「外す」を押した物を覚え、手で足し直した物は忘れる（自動で足し直さないため）
    const [previousValue, removedValue] = await Promise.all([
      readVariable(client, auth.settingsRepo, WATCHED_REPOS_VARIABLE),
      readVariable(client, auth.settingsRepo, REMOVED_REPOS_VARIABLE),
    ]);
    const removedBefore = parseRepoList(removedValue);
    const removed = updateRemovedRepos(chooseWatchedRepos(previousValue).repos, checked.repos, removedBefore);
    await writeVariable(
      client,
      auth.settingsRepo,
      WATCHED_REPOS_VARIABLE,
      formatRepoList(checked.repos),
    );
    const removedText = formatRepoList(removed);
    if (removedText !== formatRepoList(removedBefore)) {
      // 空の値は書けないので、覚える物が無くなったら Variable を消す
      if (removed.length === 0) await deleteVariable(client, auth.settingsRepo, REMOVED_REPOS_VARIABLE);
      else await writeVariable(client, auth.settingsRepo, REMOVED_REPOS_VARIABLE, removedText);
    }
  } catch (error) {
    return { ok: false, message: repoSettingErrorMessage(error) };
  }
  // Webhook が見る監視リポジトリを覚え直す
  updateTag(WATCHED_REPOS_TAG);
  refresh();
  return { ok: true };
}

/** 「新しいサービスを自動で追加」のオン・オフを `SETTINGS_REPO` の Variable `AGENT_DESK_AUTO_ADD` に保存する */
export async function saveAutoAdd(value: unknown): Promise<SaveReposResult> {
  const auth = authorizeRepoSetting({
    login: await getSignedInLogin(),
    token: await getGitHubToken(),
    allowedLogins: getAllowedLogins(),
    settingsRepo: getSettingsRepo(),
  });
  if (!auth.ok) return auth;
  if (typeof value !== "boolean") return { ok: false, message: REPO_SETTING_MESSAGES.invalid };
  try {
    await writeVariable(new GitHubClient(auth.token), auth.settingsRepo, AUTO_ADD_VARIABLE, formatAutoAddEnabled(value));
  } catch (error) {
    return { ok: false, message: repoSettingErrorMessage(error) };
  }
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

/**
 * 「並列」（昼の数・夜の数・夜の時間帯）を、パイプラインのある監視リポジトリ全部の Variable に書く。
 * 1つのリポジトリで失敗しても残りには書き、失敗した物は名前と理由を返す
 */
export async function saveParallel(value: unknown): Promise<SaveReposResult> {
  const login = await getSignedInLogin();
  const token = await getGitHubToken();
  if (!token || !isAllowedLogin(login, getAllowedLogins())) {
    return { ok: false, message: REPO_SETTING_MESSAGES.unauthorized };
  }
  const checked = checkParallelSettings(value);
  if (!checked.ok) return checked;

  const client = new GitHubClient(token);
  const failures: string[] = [];
  let written = 0;
  for (const repo of (await loadWatchedRepos()).repos) {
    const name = `${repo.owner}/${repo.repo}`;
    try {
      if (!(await hasPipeline(client, repo))) continue;
      await writeParallelSettings(client, repo, checked.settings);
      written += 1;
    } catch (error) {
      failures.push(`${name}：${repoSettingErrorMessage(error)}`);
    }
  }
  if (failures.length > 0) return { ok: false, message: failures.join(" / ") };
  if (written === 0) return { ok: false, message: PARALLEL_MESSAGES.noPipeline };
  return { ok: true };
}

/** 帯の並列の表示に要る物：保存済みの設定と、手の上書きの値（`PARALLEL_OVERRIDE`。無ければ null） */
export type ParallelSnapshot = { settings: ParallelSettings; override: string | null };

export type ParallelOverrideResult =
  | { ok: true; snapshot: ParallelSnapshot }
  | { ok: false; message: string };

/** 帯の並列の表示のために、`SETTINGS_REPO` の変数を読む。ログインしていない・`SETTINGS_REPO` が無い・読めなければ null */
export async function loadParallelSnapshot(): Promise<ParallelSnapshot | null> {
  const login = await getSignedInLogin();
  const token = await getGitHubToken();
  const settingsRepo = getSettingsRepo();
  if (!token || !settingsRepo || !isAllowedLogin(login, getAllowedLogins())) return null;
  const client = new GitHubClient(token);
  try {
    const [settings, override] = await Promise.all([
      readParallelSettings(client, settingsRepo),
      readParallelOverride(client, settingsRepo),
    ]);
    return { settings, override };
  } catch {
    return null;
  }
}

/**
 * 帯のボタン：手の上書きを、パイプラインのある監視リポジトリ全部に書く。
 * `"night"`・`"day"`＝その上限にする（期限は次の時間帯の切り替わり。サーバーで決める）、`"clear"`＝消して時間帯の決まりに戻す。
 * 1つのリポジトリで失敗しても残りには書き、失敗した物は名前と理由を返す
 */
export async function setParallelOverride(value: unknown): Promise<ParallelOverrideResult> {
  const login = await getSignedInLogin();
  const token = await getGitHubToken();
  if (!token || !isAllowedLogin(login, getAllowedLogins())) {
    return { ok: false, message: REPO_SETTING_MESSAGES.unauthorized };
  }
  if (value !== "night" && value !== "day" && value !== "clear") {
    return { ok: false, message: PARALLEL_MESSAGES.invalid };
  }

  const client = new GitHubClient(token);
  const settingsRepo = getSettingsRepo();
  let settings = DEFAULT_PARALLEL_SETTINGS;
  if (settingsRepo) {
    try {
      settings = await readParallelSettings(client, settingsRepo);
    } catch (error) {
      return { ok: false, message: repoSettingErrorMessage(error) };
    }
  }
  const text =
    value === "clear"
      ? null
      : formatParallelOverride({ period: value, until: nextPeriodSwitch(new Date(), value, settings.nightHours) });

  const failures: string[] = [];
  let written = 0;
  for (const repo of (await loadWatchedRepos()).repos) {
    const name = `${repo.owner}/${repo.repo}`;
    try {
      if (!(await hasPipeline(client, repo))) continue;
      await writeParallelOverride(client, repo, text);
      written += 1;
    } catch (error) {
      failures.push(`${name}：${repoSettingErrorMessage(error)}`);
    }
  }
  if (failures.length > 0) return { ok: false, message: failures.join(" / ") };
  if (written === 0) return { ok: false, message: PARALLEL_MESSAGES.noPipeline };
  return { ok: true, snapshot: { settings, override: text } };
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
