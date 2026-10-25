import { classifyError, GitHubError } from "./errors";

const API_BASE = "https://api.github.com";
const MAX_PAGES = 5;

export type Fetcher = typeof fetch;

/** GitHubのREST APIを `fetch` で呼ぶ。トークンはサーバー側だけで使う */
export class GitHubClient {
  private readonly token: string;
  private readonly fetcher: Fetcher;

  constructor(token: string, fetcher: Fetcher = fetch) {
    this.token = token;
    this.fetcher = fetcher;
  }

  /** 1回のGET。失敗したら GitHubError（トークンは含めない）。次のページのURLも返す */
  async request(pathOrUrl: string): Promise<{ json: unknown; next: string | null }> {
    const url = pathOrUrl.startsWith("https://") ? pathOrUrl : `${API_BASE}${pathOrUrl}`;
    let response: Response;
    try {
      response = await this.fetcher(url, {
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        cache: "no-store",
      });
    } catch {
      // ネットワークエラーの原因にはヘッダー（トークン）が入りうるので捨てる
      throw new GitHubError("other");
    }
    if (!response.ok) {
      throw new GitHubError(classifyError(response.status, response.headers), response.status);
    }
    let json: unknown;
    try {
      json = await response.json();
    } catch {
      throw new GitHubError("other", response.status);
    }
    return { json, next: parseNextLink(response.headers.get("link")) };
  }

  /** 書き込み（POST / PUT / DELETE）。失敗したら GitHubError（ステータスつき、トークンは含めない） */
  async send(method: "POST" | "PUT" | "DELETE", path: string, body?: unknown): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetcher(`${API_BASE}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: "no-store",
      });
    } catch {
      throw new GitHubError("other");
    }
    if (!response.ok) {
      throw new GitHubError(classifyError(response.status, response.headers), response.status);
    }
    if (response.status === 204) return null;
    try {
      return await response.json();
    } catch {
      return null;
    }
  }

  async get<T>(path: string): Promise<T> {
    return (await this.request(path)).json as T;
  }

  /** 配列を返すAPIを、最大 MAX_PAGES ページぶん取って1つにつなぐ */
  async getAll<T>(path: string): Promise<T[]> {
    const items: T[] = [];
    let next: string | null = path;
    for (let page = 0; next && page < MAX_PAGES; page++) {
      const result = await this.request(next);
      if (!Array.isArray(result.json)) throw new GitHubError("other");
      items.push(...(result.json as T[]));
      next = result.next;
    }
    return items;
  }
}

/** `Link` ヘッダーから `rel="next"` のURLを取る。GitHubのURL以外は辿らない（トークンを渡さないため） */
export function parseNextLink(header: string | null): string | null {
  if (!header) return null;
  for (const part of header.split(",")) {
    const match = /<([^>]+)>\s*;\s*rel="next"/.exec(part);
    if (match && match[1].startsWith(`${API_BASE}/`)) return match[1];
  }
  return null;
}
