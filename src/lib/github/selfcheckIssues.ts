import type { Fetcher } from "./client";
import type { WatchedRepo } from "../config";

// 自己点検（docs/spec.md の「自己点検：ずれの Issue 化」）が Issue を書く所。サーバーだけで使う。
// 鍵はログにもエラー文にも出さない。書けなかったとき（403 など）は例外にせず false / null を返す。

const API_BASE = "https://api.github.com";
const ISSUE_PAGES = 3;

function headers(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
  };
}

function base(repo: WatchedRepo): string {
  return `${API_BASE}/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}`;
}

/** 探した結果。読めなかったとき（ok: false）は「見つからない」（ok: true, number: null）と分ける */
export type FindIssueResult = { ok: true; number: number | null } | { ok: false };

/** 同じ題名の開いている Issue の番号を探す（PR は除く）。読めなかったら { ok: false } */
export async function findOpenIssueByTitle(
  token: string,
  repo: WatchedRepo,
  title: string,
  fetcher: Fetcher = fetch,
): Promise<FindIssueResult> {
  try {
    for (let page = 1; page <= ISSUE_PAGES; page++) {
      const response = await fetcher(`${base(repo)}/issues?state=open&per_page=100&page=${page}`, {
        headers: headers(token),
        cache: "no-store",
      });
      if (!response.ok) return { ok: false };
      const list = (await response.json()) as { number?: unknown; title?: unknown; pull_request?: unknown }[];
      if (!Array.isArray(list)) return { ok: false };
      const found = list.find((issue) => !issue.pull_request && issue.title === title && typeof issue.number === "number");
      if (found) return { ok: true, number: found.number as number };
      if (list.length < 100) break;
    }
    return { ok: true, number: null };
  } catch {
    return { ok: false };
  }
}

/** Issue を立てる（ラベルなし）。立てられたら true */
export async function createIssue(
  token: string,
  repo: WatchedRepo,
  title: string,
  body: string,
  fetcher: Fetcher = fetch,
): Promise<boolean> {
  try {
    const response = await fetcher(`${base(repo)}/issues`, {
      method: "POST",
      headers: headers(token),
      body: JSON.stringify({ title, body }),
      cache: "no-store",
    });
    return response.ok;
  } catch {
    return false;
  }
}

/** Issue にコメントを足す。足せたら true */
export async function commentIssue(
  token: string,
  repo: WatchedRepo,
  number: number,
  body: string,
  fetcher: Fetcher = fetch,
): Promise<boolean> {
  try {
    const response = await fetcher(`${base(repo)}/issues/${number}/comments`, {
      method: "POST",
      headers: headers(token),
      body: JSON.stringify({ body }),
      cache: "no-store",
    });
    return response.ok;
  } catch {
    return false;
  }
}
