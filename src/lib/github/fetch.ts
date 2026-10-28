import { cache } from "react";
import type { WatchedRepo } from "../config";
import { GitHubClient, type Fetcher } from "./client";
import {
  convertCheckRun,
  convertComment,
  convertIssue,
  convertIssueEvent,
  convertPull,
  convertStatus,
  type GhCheckRun,
  type GhComment,
  type GhIssue,
  type GhIssueEvent,
  type GhPull,
  type GhStatus,
} from "./convert";
import { GitHubError, toErrorInfo } from "./errors";
import { judgePipelineState, type PipelineProbe, type PipelineState } from "../pipelineState";
import { latestSuccessDeployAt } from "../status";
import type { WatchdogLastRun } from "../watchdogState";
import { PIPELINE_WORKFLOW_PATH } from "./settings";
import type { PullChecks, PullData, RepoData, RepoResult } from "./types";

const WINDOW_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

function nonNull<T>(value: T | null): value is T {
  return value !== null;
}

/** 1リポジトリぶんのデータ（直近14日）を取る。どれか1つでも失敗したら GitHubError を投げる */
export async function fetchRepoData(
  client: GitHubClient,
  { owner, repo }: WatchedRepo,
  now: Date = new Date(),
): Promise<RepoData> {
  const base = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  // 直近14日の境目。結果の絞り込みに使う
  const cutoffMs = now.getTime() - WINDOW_DAYS * DAY_MS;
  // URL に入れる since は日の始め（UTC の0時）に切り下げる。同じ日のあいだは URL が変わり、ETag が効く
  const since = new Date(Math.floor(cutoffMs / DAY_MS) * DAY_MS).toISOString();

  const [rawIssues, rawPulls, rawComments, rawEvents, pipeline, mainDeployedAt, watchdog] = await Promise.all([
    client.getAll<GhIssue>(
      `${base}/issues?state=all&since=${since}&sort=updated&direction=desc&per_page=100`,
    ),
    client.getAll<GhPull>(`${base}/pulls?state=all&sort=updated&direction=desc&per_page=100`),
    client.getAll<GhComment>(`${base}/issues/comments?since=${since}&per_page=100`),
    client.get<GhIssueEvent[]>(`${base}/issues/events?per_page=100`),
    fetchPipelineState(client, base),
    fetchMainDeployedAt(client, base),
    fetchWatchdogLastRun(client, base),
  ]);

  // since は切り下げているので、取ったあとで直近14日に絞り直す
  const issues = rawIssues
    .map(convertIssue)
    .filter(nonNull)
    .filter((issue) => Date.parse(issue.updatedAt) >= cutoffMs);
  const pulls = rawPulls
    .map(convertPull)
    .filter((pull) => Date.parse(pull.updatedAt) >= cutoffMs);
  const comments = rawComments
    .map(convertComment)
    .filter(nonNull)
    .filter((comment) => Date.parse(comment.createdAt) >= cutoffMs);
  const events = rawEvents.map(convertIssueEvent);

  const pullChecks: Record<number, PullChecks> = {};
  await Promise.all(
    pulls.map(async (pull) => {
      pullChecks[pull.number] = await fetchPullChecks(client, base, pull);
    }),
  );

  return { issues, pulls, comments, pullChecks, events, pipeline, mainDeployedAt, watchdog };
}

/** main の直近のコミット（新しい順）を何件まで見るか */
const MAIN_COMMITS_SAMPLE = 10;
/** 前回取れた「main の最後の公開の成功の時刻」を覚えておく件数の上限（超えたら古い物から捨てる） */
export const MAIN_DEPLOYED_CACHE_MAX_ENTRIES = 100;

/** サーバーのメモリ。キーは「トークンのハッシュ＋リポジトリ」（`GitHubClient.memoKey`） */
const lastMainDeployedAt = new Map<string, string | null>();

function rememberMainDeployedAt(key: string, value: string | null): void {
  lastMainDeployedAt.delete(key);
  lastMainDeployedAt.set(key, value);
  while (lastMainDeployedAt.size > MAIN_DEPLOYED_CACHE_MAX_ENTRIES) {
    const oldest = lastMainDeployedAt.keys().next();
    if (oldest.done) break;
    lastMainDeployedAt.delete(oldest.value);
  }
}

/** テスト用：覚えている物を空にする */
export const mainDeployedCacheForTest = { clear: (): void => lastMainDeployedAt.clear() };

/**
 * main の直近10件のコミットを新しい順に見て、公開の成功（Ignored Build Step を除く）がある
 * いちばん新しいコミットの時刻を取る（リポジトリごとに1回。見つかった時点でやめる）。
 * 取得に失敗したら、そのリポジトリで前回取れた値を使う（無ければ null）。
 * 補助の情報なので、失敗してもほかのデータは落とさない
 */
async function fetchMainDeployedAt(client: GitHubClient, base: string): Promise<string | null> {
  const key = client.memoKey(base);
  try {
    const commits = await client.get<{ sha?: unknown }[]>(
      `${base}/commits?sha=main&per_page=${MAIN_COMMITS_SAMPLE}`,
    );
    if (!Array.isArray(commits)) throw new GitHubError("other");
    let found: string | null = null;
    for (const commit of commits.slice(0, MAIN_COMMITS_SAMPLE)) {
      if (typeof commit?.sha !== "string") throw new GitHubError("other");
      const status = await client.get<{ statuses?: GhStatus[] }>(
        `${base}/commits/${encodeURIComponent(commit.sha)}/status?per_page=100`,
      );
      found = latestSuccessDeployAt((status.statuses ?? []).map(convertStatus));
      if (found) break;
    }
    rememberMainDeployedAt(key, found);
    return found;
  } catch {
    return lastMainDeployedAt.get(key) ?? null;
  }
}

/**
 * `watchdog.yml` の最後の実行の時刻を取る。404（ワークフローが無い）と実行0件は「無い」、
 * それ以外の失敗・形が違うときは「分からない」。補助の情報なので、失敗してもほかのデータは落とさない
 */
async function fetchWatchdogLastRun(client: GitHubClient, base: string): Promise<WatchdogLastRun> {
  try {
    const runs = await client.get<{ workflow_runs?: unknown }>(
      `${base}/actions/workflows/watchdog.yml/runs?per_page=1`,
    );
    if (!Array.isArray(runs?.workflow_runs)) return "unknown";
    if (runs.workflow_runs.length === 0) return "none";
    const createdAt = (runs.workflow_runs[0] as { created_at?: unknown } | null)?.created_at;
    return typeof createdAt === "string" && !Number.isNaN(Date.parse(createdAt))
      ? { at: createdAt }
      : "unknown";
  } catch (error) {
    return error instanceof GitHubError && error.status === 404 ? "none" : "unknown";
  }
}

/** `pipeline.yml` の実行を1件だけ取り、動いているか判定する。調べられなければ「分からない」 */
async function fetchPipelineState(client: GitHubClient, base: string): Promise<PipelineState> {
  const workflowFile = PIPELINE_WORKFLOW_PATH.split("/").at(-1) ?? "";
  let probe: PipelineProbe = null;
  try {
    const runs = await client.get<{ total_count?: unknown }>(
      `${base}/actions/workflows/${encodeURIComponent(workflowFile)}/runs?per_page=1`,
    );
    if (typeof runs?.total_count === "number") {
      probe = { workflowExists: true, runCount: runs.total_count };
    }
  } catch (error) {
    if (error instanceof GitHubError && error.status === 404) {
      probe = { workflowExists: false, runCount: 0 };
    }
  }
  return judgePipelineState(probe);
}

async function fetchPullChecks(
  client: GitHubClient,
  base: string,
  pull: PullData,
): Promise<PullChecks> {
  const [runs, statuses] = await Promise.all([
    client.get<{ check_runs?: GhCheckRun[] }>(
      `${base}/commits/${encodeURIComponent(pull.headSha)}/check-runs?per_page=100`,
    ),
    pull.merged && pull.mergeCommitSha
      ? client.get<{ statuses?: GhStatus[] }>(
          `${base}/commits/${encodeURIComponent(pull.mergeCommitSha)}/status?per_page=100`,
        )
      : Promise.resolve<{ statuses?: GhStatus[] }>({ statuses: [] }),
  ]);
  return {
    checkRuns: (runs.check_runs ?? []).map(convertCheckRun),
    statuses: (statuses.statuses ?? []).map(convertStatus),
  };
}

/** 監視リポジトリ全部を取る。1つが失敗しても、ほかは取れる（エラーはリポジトリごとに返す） */
export async function fetchAllRepos(
  token: string,
  repos: WatchedRepo[],
  options: { fetcher?: Fetcher; now?: Date } = {},
): Promise<RepoResult[]> {
  const client = new GitHubClient(token, options.fetcher);
  return Promise.all(
    repos.map(async (repo): Promise<RepoResult> => {
      const { owner, repo: name } = repo;
      try {
        const data = await fetchRepoData(client, repo, options.now);
        return { owner, repo: name, ok: true, data };
      } catch (error) {
        return { owner, repo: name, ok: false, error: toErrorInfo(error) };
      }
    }),
  );
}

/**
 * 1回のリクエスト（サーバーのレンダリング）の中では、同じ引数なら取得結果を使い回す。
 * React の cache は引数を参照で比べるので、リポジトリは文字列にして渡す
 */
const fetchAllReposOnce = cache((token: string, reposKey: string) =>
  fetchAllRepos(token, JSON.parse(reposKey) as WatchedRepo[]),
);

export function getRepoResults(token: string, repos: WatchedRepo[]): Promise<RepoResult[]> {
  return fetchAllReposOnce(token, JSON.stringify(repos));
}
