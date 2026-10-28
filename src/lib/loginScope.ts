import { getSettingsRepo, getWatchedRepos, type Env, type WatchedRepo } from "./config";
import { fetchRepoIsPublic, type Fetcher } from "./github/repoVisibility";

export const PUBLIC_SCOPE = "read:user public_repo";
export const PRIVATE_SCOPE = "read:user repo";

/** 公開と分かった結果を、サーバーのメモリに覚えておく時間（約1時間） */
export const VISIBILITY_TTL_MS = 60 * 60 * 1000;

// キーは小文字の `owner/repo`。値は覚えた時刻。公開と分かった物だけ入れ、失敗は入れない
const publicCache = new Map<string, number>();

export const loginScopeCacheForTest = {
  clear: (): void => publicCache.clear(),
};

type Options = { fetcher?: Fetcher; now?: () => number };

async function isPublic(repo: WatchedRepo, { fetcher, now = Date.now }: Options): Promise<boolean> {
  const key = `${repo.owner}/${repo.repo}`.toLowerCase();
  const at = publicCache.get(key);
  if (at !== undefined && now() - at < VISIBILITY_TTL_MS) return true;
  publicCache.delete(key);
  const result = await fetchRepoIsPublic(repo.owner, repo.repo, fetcher);
  if (result !== true) return false;
  publicCache.set(key, now());
  return true;
}

/** リポジトリが全部公開なら `read:user public_repo`、1つでも非公開・不明、または0件なら `read:user repo` */
export async function decideLoginScope(
  repos: WatchedRepo[],
  options: Options = {},
): Promise<string> {
  if (repos.length === 0) return PRIVATE_SCOPE;
  const results = await Promise.all(repos.map((repo) => isPublic(repo, options)));
  return results.every(Boolean) ? PUBLIC_SCOPE : PRIVATE_SCOPE;
}

/** 環境変数 `WATCHED_REPOS` と `SETTINGS_REPO` から、ログインで頼む権限を決める */
export async function getLoginScope(env: Env = process.env, options: Options = {}): Promise<string> {
  const settings = getSettingsRepo(env);
  const repos = [...getWatchedRepos(env), ...(settings ? [settings] : [])];
  return decideLoginScope(repos, options);
}
