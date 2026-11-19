import type { WatchedRepo } from "../config";

/** `Authorization: Bearer <鍵>` から鍵を取り出す。無い・形が違うときは null */
export function parseBearer(header: string | null | undefined): string | null {
  const match = header?.match(/^Bearer\s+(\S+)\s*$/i);
  return match ? match[1] : null;
}

function key({ owner, repo }: WatchedRepo): string {
  return `${owner}/${repo}`.toLowerCase();
}

/** `GET /installation/repositories` の返事から、読めたリポジトリを取り出す（形が違えば空） */
export function parseInstallationRepositories(body: unknown): WatchedRepo[] {
  const list = (body as { repositories?: unknown } | null)?.repositories;
  if (!Array.isArray(list)) return [];
  const repos: WatchedRepo[] = [];
  for (const item of list) {
    const value = item as { name?: unknown; owner?: { login?: unknown } | null } | null;
    const owner = value?.owner?.login;
    const name = value?.name;
    if (typeof owner === "string" && typeof name === "string" && owner !== "" && name !== "") {
      repos.push({ owner, repo: name });
    }
  }
  return repos;
}

/** 読めたリポジトリのうち、監視しているもの（監視リポジトリの並び順。大文字小文字は区別しない） */
export function watchedAmong(readable: WatchedRepo[], watched: WatchedRepo[]): WatchedRepo[] {
  const keys = new Set(readable.map(key));
  return watched.filter((repo) => keys.has(key(repo)));
}

/** App の ID を文字列にそろえる（GitHub は数、環境変数は文字列） */
function normalizeAppId(value: unknown): string | null {
  if (typeof value === "number" && Number.isInteger(value)) return String(value);
  if (typeof value === "string" && value.trim() !== "") return value.trim();
  return null;
}

/**
 * 自己点検の鍵を受け付けるか（docs/spec.md の「自己点検」）。
 * (a) 読めたリポジトリに、監視しているリポジトリが含まれる、(b) 鍵の App の ID が `PIPELINE_APP_ID` と同じ、の両方を満たすときだけ true
 */
export function isSelfcheckKeyAccepted(input: {
  installationRepositories: unknown;
  watched: WatchedRepo[];
  appId: string | null | undefined;
  keyAppId: unknown;
}): boolean {
  const expected = normalizeAppId(input.appId);
  const actual = normalizeAppId(input.keyAppId);
  if (expected === null || actual === null || expected !== actual) return false;
  return watchedAmong(parseInstallationRepositories(input.installationRepositories), input.watched).length > 0;
}
