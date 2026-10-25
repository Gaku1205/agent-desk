export type Env = Record<string, string | undefined>;

export type WatchedRepo = {
  owner: string;
  repo: string;
};

function splitList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item !== "");
}

/** `WATCHED_REPOS`（`owner/repo` のカンマ区切り）を読む。形の合わないものと重複は捨てる */
export function getWatchedRepos(env: Env = process.env): WatchedRepo[] {
  const repos: WatchedRepo[] = [];
  const seen = new Set<string>();
  for (const item of splitList(env.WATCHED_REPOS)) {
    const parts = item.split("/");
    if (parts.length !== 2) continue;
    const [owner, repo] = parts.map((part) => part.trim());
    if (!owner || !repo) continue;
    const key = `${owner}/${repo}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    repos.push({ owner, repo });
  }
  return repos;
}

/** `ALLOWED_GITHUB_LOGINS`（カンマ区切り）を読む。GitHubのユーザー名は大文字小文字を区別しないので小文字にそろえる */
export function getAllowedLogins(env: Env = process.env): string[] {
  const logins = splitList(env.ALLOWED_GITHUB_LOGINS).map((login) =>
    login.toLowerCase(),
  );
  return [...new Set(logins)];
}

/** URLの `owner` / `repo` が監視リポジトリなら、設定に書かれた表記で返す */
export function findWatchedRepo(
  owner: string,
  repo: string,
  watched: WatchedRepo[],
): WatchedRepo | undefined {
  const key = `${owner}/${repo}`.toLowerCase();
  return watched.find((w) => `${w.owner}/${w.repo}`.toLowerCase() === key);
}
