const API_BASE = "https://api.github.com";

export type Fetcher = typeof fetch;

/**
 * リポジトリが公開かどうかを、トークン無しで `GET /repos/{owner}/{repo}` の `private` から調べる。
 * 調べられなかったとき（通信失敗・404・403・`private` が読めない等）は null（公開か不明）
 */
export async function fetchRepoIsPublic(
  owner: string,
  repo: string,
  fetcher: Fetcher = fetch,
): Promise<boolean | null> {
  try {
    const response = await fetcher(
      `${API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        cache: "no-store",
      },
    );
    if (!response.ok) return null;
    const json: unknown = await response.json();
    if (typeof json !== "object" || json === null) return null;
    const isPrivate = (json as { private?: unknown }).private;
    return typeof isPrivate === "boolean" ? !isPrivate : null;
  } catch {
    return null;
  }
}
