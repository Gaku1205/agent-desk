import type { WatchedRepo } from "../config";
import {
  convertExtendedNodes,
  extendedCutoff,
  type ExtendedIssueNode,
  type ExtendedPullNode,
} from "../dashboard/extended";
import { forgetInstallation, resolveReadAccess } from "./appToken";
import { GitHubClient, type Fetcher } from "./client";
import { GitHubError, toErrorInfo } from "./errors";
import { COMMENTS, LABEL_EVENTS } from "./graphql";
import type { RepoData, RepoResult } from "./types";

/**
 * Dashboard の `30d` のための、60日分の取得（docs/spec.md の「Dashboard」）。
 * 「今」から60日前までのマージ済みPRと、Issue（作成時刻・進捗ログ・ラベルの出来事）だけを、`30d` を選んだときに取る。
 * ホーム・リポジトリのページの取得（`fetchRepoData`。直近14日）とは別で、5分覚える
 */

/** 1ページの件数。点数は `first` で決まる（つながりごとに親の数だけ要求を数える）ので、1ページ50件なら 1ページ約1点 */
export const EXTENDED_PAGE_SIZE = 50;
/** Issue・PR それぞれ、ページ送りで取る最大のページ数（50件×10＝500件） */
export const EXTENDED_MAX_PAGES = 10;
/** 覚える時間（Actions の runs と同じ5分） */
export const EXTENDED_CACHE_MS = 5 * 60_000;
/** 覚えておく件数の上限（超えたら古い物から捨てる） */
export const EXTENDED_CACHE_MAX_ENTRIES = 100;

/**
 * 60日分の問い合わせ。Issue は作成時刻・コメント・ラベルの出来事、マージ済みPR は番号・本文・ブランチ名・マージの時刻・
 * コメント・ラベルの出来事だけ。チェック・公開ステータス・ファイル名・ラベル・題名は取らない
 */
export const EXTENDED_QUERY = `
query DashboardExtended(
  $owner: String!
  $name: String!
  $since: DateTime!
  $issuesAfter: String
  $pullsAfter: String
  $withIssues: Boolean!
  $withPulls: Boolean!
) {
  rateLimit { cost remaining resetAt }
  repository(owner: $owner, name: $name) {
    issues(
      first: ${EXTENDED_PAGE_SIZE}
      after: $issuesAfter
      filterBy: { since: $since }
      orderBy: { field: UPDATED_AT, direction: DESC }
    ) @include(if: $withIssues) {
      pageInfo { hasNextPage endCursor }
      nodes {
        number createdAt updatedAt
        ${COMMENTS}
        ${LABEL_EVENTS}
      }
    }
    pullRequests(
      first: ${EXTENDED_PAGE_SIZE}
      after: $pullsAfter
      orderBy: { field: UPDATED_AT, direction: DESC }
    ) @include(if: $withPulls) {
      pageInfo { hasNextPage endCursor }
      nodes {
        number body headRefName createdAt updatedAt mergedAt
        ${COMMENTS}
        ${LABEL_EVENTS}
      }
    }
  }
}
`;

/**
 * 問い合わせ1回の点数の見積もり（`repoQueryCost` と同じ数え方）。つながりごとに、親の数だけ「要求」を数え、100で割って四捨五入する。
 * Issue：一覧で1、Issue 1件ごとにコメント・ラベルの出来事の2。PR：同じ
 */
export function extendedQueryCost(parts: { withIssues: boolean; withPulls: boolean }): number {
  let requests = 0;
  if (parts.withIssues) requests += 1 + EXTENDED_PAGE_SIZE * 2;
  if (parts.withPulls) requests += 1 + EXTENDED_PAGE_SIZE * 2;
  return Math.max(1, Math.round(requests / 100));
}

type Page<T> = { nodes: T[]; next: string | null };

function readPage<T extends { updatedAt: string }>(connection: unknown): Page<T> | null {
  if (typeof connection !== "object" || connection === null) return null;
  const { nodes, pageInfo } = connection as {
    nodes?: (T | null)[] | null;
    pageInfo?: { hasNextPage?: boolean | null; endCursor?: string | null } | null;
  };
  const list = (nodes ?? []).filter((node): node is T => node !== null);
  const next = pageInfo?.hasNextPage && typeof pageInfo.endCursor === "string" ? pageInfo.endCursor : null;
  return { nodes: list, next };
}

/** 1リポジトリの60日分を取る。GraphQL が失敗したら GitHubError を投げる */
export async function fetchExtendedRepoData(client: GitHubClient, { owner, repo }: WatchedRepo, now: Date): Promise<RepoData> {
  const cutoff = extendedCutoff(now);
  const since = new Date(cutoff).toISOString();
  const issues: ExtendedIssueNode[] = [];
  const pulls: ExtendedPullNode[] = [];
  let issuesAfter: string | null = null;
  let pullsAfter: string | null = null;
  let issuePages = 0;
  let pullPages = 0;
  let withIssues = true;
  let withPulls = true;
  while (withIssues || withPulls) {
    const data = (await client.graphql(EXTENDED_QUERY, {
      owner,
      name: repo,
      since,
      issuesAfter,
      pullsAfter,
      withIssues,
      withPulls,
    })) as { repository?: { issues?: unknown; pullRequests?: unknown } | null } | null;
    const repository = data?.repository;
    if (!repository) throw new GitHubError("not_found");
    if (withIssues) {
      issuePages++;
      const page = readPage<ExtendedIssueNode>(repository.issues);
      issues.push(...(page?.nodes ?? []));
      const oldest = page?.nodes.at(-1);
      issuesAfter = page?.next ?? null;
      // 更新の新しい順なので、いちばん古い物が60日前より前になったら、続きは要らない
      withIssues = issuesAfter !== null && issuePages < EXTENDED_MAX_PAGES && oldest !== undefined && Date.parse(oldest.updatedAt) >= cutoff;
    }
    if (withPulls) {
      pullPages++;
      const page = readPage<ExtendedPullNode>(repository.pullRequests);
      pulls.push(...(page?.nodes ?? []));
      const oldest = page?.nodes.at(-1);
      pullsAfter = page?.next ?? null;
      withPulls = pullsAfter !== null && pullPages < EXTENDED_MAX_PAGES && oldest !== undefined && Date.parse(oldest.updatedAt) >= cutoff;
    }
  }
  return convertExtendedNodes(owner, issues, pulls, now);
}

/** サーバーのメモリ。キーは「トークンのハッシュ＋リポジトリ」（`GitHubClient.memoKey`）。再起動で消えてよい */
const extendedCache = new Map<string, { at: number; data: RepoData }>();

/** テスト用：覚えている物を空にする */
export const extendedCacheForTest = { clear: (): void => extendedCache.clear(), size: (): number => extendedCache.size };

/** 5分以内なら覚えた物を返し、GitHub を読まない。古ければ取り直して覚える（件数の上限を超えたら古い物から捨てる） */
async function cachedExtended(client: GitHubClient, repo: WatchedRepo, now: Date): Promise<RepoData> {
  const key = client.memoKey(`/repos/${repo.owner}/${repo.repo}#dashboard-extended`);
  const nowMs = now.getTime();
  const known = extendedCache.get(key);
  if (known && nowMs >= known.at && nowMs - known.at < EXTENDED_CACHE_MS) return known.data;
  const data = await fetchExtendedRepoData(client, repo, now);
  extendedCache.delete(key);
  extendedCache.set(key, { at: nowMs, data });
  while (extendedCache.size > EXTENDED_CACHE_MAX_ENTRIES) {
    const oldest = extendedCache.keys().next();
    if (oldest.done) break;
    extendedCache.delete(oldest.value);
  }
  return data;
}

/**
 * 監視リポジトリ全部の60日分を取る。1つが失敗しても、ほかは取れる（失敗はリポジトリごとに `ok: false`）。
 * 読む鍵は同期と同じ（使えるときだけ App のインストールの鍵、無ければログインした人のトークン）
 */
export async function fetchExtendedRepos(
  token: string,
  repos: WatchedRepo[],
  options: { fetcher?: Fetcher; now?: Date } = {},
): Promise<RepoResult[]> {
  const now = options.now ?? new Date();
  const userClient = new GitHubClient(token, options.fetcher);
  return Promise.all(
    repos.map(async (repo): Promise<RepoResult> => {
      const { owner, repo: name } = repo;
      const access = await resolveReadAccess(token, repo, { fetcher: options.fetcher, nowMs: now.getTime() }).catch(() => null);
      const readSource = access ? "app" : "user";
      try {
        const client = access
          ? new GitHubClient(access.token, options.fetcher, { source: "app", keyId: access.keyId })
          : userClient;
        return { owner, repo: name, ok: true, data: await cachedExtended(client, repo, now), readSource };
      } catch (error) {
        if (access && error instanceof GitHubError && (error.kind === "forbidden" || error.kind === "not_found")) {
          forgetInstallation(repo);
          try {
            return { owner, repo: name, ok: true, data: await cachedExtended(userClient, repo, now), readSource: "user" };
          } catch (retryError) {
            return { owner, repo: name, ok: false, error: toErrorInfo(retryError), readSource: "user" };
          }
        }
        return { owner, repo: name, ok: false, error: toErrorInfo(error), readSource };
      }
    }),
  );
}
