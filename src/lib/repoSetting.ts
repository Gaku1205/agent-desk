import { isAllowedLogin } from "./allowlist";
import type { WatchedRepo } from "./config";
import { GitHubError } from "./github/errors";

export const REPO_SETTING_MESSAGES = {
  unauthorized: "ログインし直してください",
  noSettingsRepo: "設定の保存先（SETTINGS_REPO）が無いため変えられません",
  invalid: "リポジトリは owner/repo の形で指定してください",
  empty: "監視するリポジトリを1つ以上選んでください",
  unreadable: "読めないリポジトリは追加できません",
  forbidden: "このリポジトリの設定を変える権限がありません",
  rateLimited: "GitHubのレート制限に達しました。しばらくしてからもう一度試してください",
  failed: "設定を保存できませんでした",
} as const;

const NAME = /^[\w.-]+$/;

function isRepoName(name: string): boolean {
  return NAME.test(name) && name !== "." && name !== "..";
}

/** `owner/repo` の1件を読む。形が合わなければ null */
export function parseRepoName(value: string): WatchedRepo | null {
  const parts = value.trim().split("/");
  if (parts.length !== 2) return null;
  const [owner, repo] = parts;
  if (!isRepoName(owner) || !isRepoName(repo)) return null;
  return { owner, repo };
}

export type RepoListCheck =
  | { ok: true; repos: WatchedRepo[] }
  | { ok: false; message: string };

/**
 * ブラウザから来た「監視するリポジトリ」の並びを確かめる（Server Actionは誰でも直接呼べるため）。
 * 文字列の配列で、どれも `owner/repo` の形であること。大文字小文字だけ違う重複は最初の物を残す。0件は不可
 */
export function checkRepoList(value: unknown): RepoListCheck {
  if (!Array.isArray(value)) return { ok: false, message: REPO_SETTING_MESSAGES.invalid };
  const repos: WatchedRepo[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") return { ok: false, message: REPO_SETTING_MESSAGES.invalid };
    const parsed = parseRepoName(item);
    if (!parsed) return { ok: false, message: REPO_SETTING_MESSAGES.invalid };
    const key = repoKey(parsed);
    if (seen.has(key)) continue;
    seen.add(key);
    repos.push(parsed);
  }
  if (repos.length === 0) return { ok: false, message: REPO_SETTING_MESSAGES.empty };
  return { ok: true, repos };
}

/** 大文字小文字をそろえた `owner/repo`（比べる用） */
export function repoKey({ owner, repo }: WatchedRepo): string {
  return `${owner}/${repo}`.toLowerCase();
}

/** 読めるリポジトリの一覧（`owner/repo`）に入っていない物 */
export function findUnlisted(repos: WatchedRepo[], readable: string[]): WatchedRepo[] {
  const keys = new Set(readable.map((name) => name.toLowerCase()));
  return repos.filter((repo) => !keys.has(repoKey(repo)));
}

export type RepoSettingAuthInput = {
  login: string | null;
  token: string | null;
  allowedLogins: string[];
  settingsRepo: WatchedRepo | null;
};

/** ログイン中かつ許可リストのユーザーで、`SETTINGS_REPO` があるときだけ保存を通す */
export function authorizeRepoSetting(
  input: RepoSettingAuthInput,
):
  | { ok: true; token: string; settingsRepo: WatchedRepo }
  | { ok: false; message: string } {
  if (!input.token || !isAllowedLogin(input.login, input.allowedLogins)) {
    return { ok: false, message: REPO_SETTING_MESSAGES.unauthorized };
  }
  if (!input.settingsRepo) return { ok: false, message: REPO_SETTING_MESSAGES.noSettingsRepo };
  return { ok: true, token: input.token, settingsRepo: input.settingsRepo };
}

/** 保存に失敗したときのGitHubのエラーを、画面に出す理由にする */
export function repoSettingErrorMessage(error: unknown): string {
  if (error instanceof GitHubError) {
    if (error.kind === "unauthorized") return REPO_SETTING_MESSAGES.unauthorized;
    if (error.kind === "forbidden" || error.kind === "not_found") {
      return REPO_SETTING_MESSAGES.forbidden;
    }
    if (error.kind === "rate_limited") return REPO_SETTING_MESSAGES.rateLimited;
  }
  return REPO_SETTING_MESSAGES.failed;
}

/** Variable に書く値（`owner/repo` のカンマ区切り） */
export function formatRepoList(repos: WatchedRepo[]): string {
  return repos.map(({ owner, repo }) => `${owner}/${repo}`).join(",");
}
