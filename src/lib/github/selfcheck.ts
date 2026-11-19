import { buildAppJwt, readAppCredentials } from "./appAuth";
import { GitHubClient, type Fetcher } from "./client";
import { readVariable, WATCHED_REPOS_VARIABLE } from "./settings";
import type { Env, WatchedRepo } from "../config";

// 自己点検（docs/spec.md の「自己点検」）が GitHub を呼ぶ所。サーバーだけで使う。
// 呼ばれた鍵・JWT はログにもエラー文にも出さない。

const API_BASE = "https://api.github.com";
const INSTALLATION_REPOS_PAGES = 5;

function headers(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

/**
 * `GET /installation/repositories`（呼ばれた鍵で読めるリポジトリ）。100件ずつ、最大5ページ。
 * 読めない鍵（401 など）・通信失敗は null。返事は `{ repositories: [...] }` の形にまとめる
 */
export async function fetchInstallationRepositories(
  token: string,
  fetcher: Fetcher = fetch,
): Promise<{ repositories: unknown[] } | null> {
  const repositories: unknown[] = [];
  try {
    for (let page = 1; page <= INSTALLATION_REPOS_PAGES; page++) {
      const response = await fetcher(`${API_BASE}/installation/repositories?per_page=100&page=${page}`, {
        headers: headers(token),
        cache: "no-store",
      });
      if (!response.ok) return null;
      const body = (await response.json()) as { repositories?: unknown } | null;
      const list = Array.isArray(body?.repositories) ? body.repositories : [];
      repositories.push(...list);
      if (list.length < 100) break;
    }
    return { repositories };
  } catch {
    return null;
  }
}

/**
 * パイプラインの App の JWT で `GET /repos/{owner}/{repo}/installation` を呼び、返事の `app_id` を返す。
 * 環境変数が無い・入っていない・通信失敗は null
 */
export async function fetchPipelineInstallationAppId(
  repo: WatchedRepo,
  options: { env?: Env; fetcher?: Fetcher; nowMs?: number } = {},
): Promise<number | null> {
  const credentials = readAppCredentials(options.env);
  if (!credentials) return null;
  const jwt = buildAppJwt(credentials.appId, credentials.privateKey, options.nowMs ?? Date.now());
  try {
    const response = await (options.fetcher ?? fetch)(
      `${API_BASE}/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/installation`,
      { headers: headers(jwt), cache: "no-store" },
    );
    if (!response.ok) return null;
    const body = (await response.json()) as { app_id?: unknown } | null;
    return typeof body?.app_id === "number" ? body.app_id : null;
  } catch {
    return null;
  }
}

/** 設定の Variable `AGENT_DESK_WATCHED_REPOS` を、呼ばれた鍵で読む。読めなければ null */
export async function readWatchedVariableWith(
  token: string,
  settingsRepo: WatchedRepo,
  fetcher: Fetcher = fetch,
): Promise<string | null> {
  try {
    return await readVariable(new GitHubClient(token, fetcher), settingsRepo, WATCHED_REPOS_VARIABLE);
  } catch {
    return null;
  }
}
