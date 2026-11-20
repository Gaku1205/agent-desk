import type { Fetcher } from "./client";
import type { WatchedRepo } from "../config";
import { createIssue } from "./selfcheckIssues";
import { dateKeyFromTitle, parseUsageBody } from "../usage/cpuBudget";

// 使用量の Issue（docs/spec.md の「使用量の数え方と知らせ方」）を読み書きする所。サーバーだけで使う。
// 鍵はログにもエラー文にも出さない。読めなかった・書けなかったとき（403 など）は例外にせず null / false を返す。

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

/** 日ごとの Issue。日付キー → 番号と今の合計 ms */
export type UsageIssues = Map<string, { number: number; totalMs: number }>;

/** 開いている `使用量：YYYY-MM-DD` の Issue を読む。読めなかったら null */
export async function listUsageIssues(
  token: string,
  repo: WatchedRepo,
  fetcher: Fetcher = fetch,
): Promise<UsageIssues | null> {
  try {
    const found: UsageIssues = new Map();
    for (let page = 1; page <= ISSUE_PAGES; page++) {
      const response = await fetcher(`${base(repo)}/issues?state=open&per_page=100&page=${page}`, {
        headers: headers(token),
        cache: "no-store",
      });
      if (!response.ok) return null;
      const list = (await response.json()) as { number?: unknown; title?: unknown; body?: unknown; pull_request?: unknown }[];
      if (!Array.isArray(list)) return null;
      for (const issue of list) {
        if (issue.pull_request || typeof issue.title !== "string" || typeof issue.number !== "number") continue;
        const key = dateKeyFromTitle(issue.title);
        if (!key || found.has(key)) continue;
        found.set(key, { number: issue.number, totalMs: parseUsageBody(typeof issue.body === "string" ? issue.body : null) ?? 0 });
      }
      if (list.length < 100) break;
    }
    return found;
  } catch {
    return null;
  }
}

/** 日ごとの Issue を立てる（ラベルなし）。立てられたら true */
export function createUsageIssue(
  token: string,
  repo: WatchedRepo,
  title: string,
  body: string,
  fetcher: Fetcher = fetch,
): Promise<boolean> {
  return createIssue(token, repo, title, body, fetcher);
}

/** Issue の本文を書き直す（PATCH）。書けたら true */
export async function updateIssueBody(
  token: string,
  repo: WatchedRepo,
  number: number,
  body: string,
  fetcher: Fetcher = fetch,
): Promise<boolean> {
  try {
    const response = await fetcher(`${base(repo)}/issues/${number}`, {
      method: "PATCH",
      headers: headers(token),
      body: JSON.stringify({ body }),
      cache: "no-store",
    });
    return response.ok;
  } catch {
    return false;
  }
}
