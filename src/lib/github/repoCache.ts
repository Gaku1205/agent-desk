import { unstable_cache } from "next/cache";
import { repoChangeKey, type ChangeMarks } from "../changeMarks";
import { getSettingsRepo, getWatchedRepos, parseRepoList, type Env, type WatchedRepo } from "../config";
import { repoTag } from "../webhook";
import { resolveAppAccess } from "./appToken";
import { GitHubClient } from "./client";
import { readVariable, WATCHED_REPOS_VARIABLE } from "./settings";
import type { RepoData } from "./types";

// Next.js のキャッシュ（`unstable_cache`。タグで無効にでき、Vercel では全部のインスタンスに効く）に、
// App の鍵で読んだリポジトリのデータと「変わった」印を覚える（docs/spec.md の「更新」）。サーバーだけで使う。
// Cache Components（`use cache`・`cacheTag`）は画面全体の作りが変わるので使わず、同じタグの仕組みの `unstable_cache` を使う。

/** キャッシュの寿命（秒）。Webhook が届かなかったときの保険 */
export const REPO_CACHE_SECONDS = 5 * 60;
/** Webhook が見る「設定の監視リポジトリ」のタグ。設定を保存したら無効にする */
export const WATCHED_REPOS_TAG = "watched-repos";

/** データの形が変わった公開の後に、前の公開で覚えた物を使わないため */
const DEPLOY_KEY = process.env.VERCEL_DEPLOYMENT_ID ?? process.env.VERCEL_GIT_COMMIT_SHA ?? "local";

/** Webhook を使う設定か（`GITHUB_WEBHOOK_SECRET` があるか） */
export function isWebhookEnabled(env: Env = process.env): boolean {
  return Boolean(env.GITHUB_WEBHOOK_SECRET);
}

/**
 * App の鍵で読むリポジトリのデータを、タグ `repo:<owner>/<repo>` つきで最大5分覚える。
 * キーはリポジトリだけ（鍵は1時間で替わるので入れない。App の鍵で読むのは、ログインした人が読めると確かめた物だけ）
 */
export function cachedRepoData(repo: WatchedRepo, load: () => Promise<RepoData>): Promise<RepoData> {
  return unstable_cache(load, ["repo-data", DEPLOY_KEY, repoChangeKey(repo)], {
    tags: [repoTag(repo)],
    revalidate: REPO_CACHE_SECONDS,
  })();
}

/**
 * そのリポジトリの「最後に変わった時刻」。タグ `repo:<owner>/<repo>` が無効になった後に初めて読んだ時刻で、
 * 次に無効になるまで変わらない。GitHub には問い合わせない
 */
export function getChangeMark(repo: WatchedRepo): Promise<string> {
  return unstable_cache(async () => new Date().toISOString(), ["repo-changed-at", repoChangeKey(repo)], {
    tags: [repoTag(repo)],
  })();
}

/** 監視リポジトリごとの「最後に変わった時刻」 */
export async function getChangeMarks(repos: WatchedRepo[]): Promise<ChangeMarks> {
  const entries = await Promise.all(
    repos.map(async (repo) => [repoChangeKey(repo), await getChangeMark(repo)] as const),
  );
  return Object.fromEntries(entries);
}

/** 設定の Variable を App の鍵で読んだ結果。`known` が false のときは読めなかった（分からない） */
type SettingsVariable = { known: boolean; value: string | null };

async function readSettingsVariable(settingsRepo: WatchedRepo): Promise<SettingsVariable> {
  const access = await resolveAppAccess(settingsRepo).catch(() => null);
  if (!access) return { known: false, value: null };
  try {
    const client = new GitHubClient(access.token, undefined, { source: "app", keyId: access.keyId });
    return { known: true, value: await readVariable(client, settingsRepo, WATCHED_REPOS_VARIABLE) };
  } catch {
    return { known: false, value: null };
  }
}

/**
 * Webhook が見る監視リポジトリ：環境変数 `WATCHED_REPOS` と、設定の監視リポジトリ（App の鍵で読み、最大5分覚える）。
 * 設定の保存先があるのに読めないときは null（分からない）
 */
export async function loadWebhookWatchedRepos(env: Env = process.env): Promise<WatchedRepo[] | null> {
  const fromEnv = getWatchedRepos(env);
  const settingsRepo = getSettingsRepo(env);
  if (!settingsRepo) return fromEnv;
  const variable = await unstable_cache(
    () => readSettingsVariable(settingsRepo),
    ["webhook-watched-repos", repoChangeKey(settingsRepo)],
    { tags: [WATCHED_REPOS_TAG], revalidate: REPO_CACHE_SECONDS },
  )();
  if (!variable.known) return null;
  return [...fromEnv, ...parseRepoList(variable.value)];
}
