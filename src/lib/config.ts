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

/** `owner/repo` のカンマ区切りを読む。形の合わないものと重複は捨てる */
export function parseRepoList(value: string | null | undefined): WatchedRepo[] {
  const repos: WatchedRepo[] = [];
  const seen = new Set<string>();
  for (const item of splitList(value ?? undefined)) {
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

/** 環境変数 `WATCHED_REPOS`（`owner/repo` のカンマ区切り）を読む */
export function getWatchedRepos(env: Env = process.env): WatchedRepo[] {
  return parseRepoList(env.WATCHED_REPOS);
}

/** 設定画面の保存先 `SETTINGS_REPO`（`owner/repo`）。無い・形が合わなければ null */
export function getSettingsRepo(env: Env = process.env): WatchedRepo | null {
  const value = env.SETTINGS_REPO?.trim();
  if (!value || value.includes(",")) return null;
  return parseRepoList(value)[0] ?? null;
}

export type WatchedReposSource = "variable" | "env";

/**
 * 画面全体の「監視するリポジトリ」を選ぶ。
 * Variable `AGENT_DESK_WATCHED_REPOS` があり、形の合う物が1件以上あればそれを、無ければ `WATCHED_REPOS` を使う
 */
export function chooseWatchedRepos(
  variableValue: string | null,
  env: Env = process.env,
): { repos: WatchedRepo[]; source: WatchedReposSource } {
  const fromVariable = parseRepoList(variableValue);
  if (fromVariable.length > 0) return { repos: fromVariable, source: "variable" };
  return { repos: getWatchedRepos(env), source: "env" };
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
