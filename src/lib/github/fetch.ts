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
  const since = new Date(now.getTime() - WINDOW_DAYS * DAY_MS).toISOString();

  const [rawIssues, rawPulls, rawComments, rawEvents, pipeline, mainDeployedAt] = await Promise.all([
    client.getAll<GhIssue>(
      `${base}/issues?state=all&since=${since}&sort=updated&direction=desc&per_page=100`,
    ),
    client.getAll<GhPull>(`${base}/pulls?state=all&sort=updated&direction=desc&per_page=100`),
    client.getAll<GhComment>(`${base}/issues/comments?since=${since}&per_page=100`),
    client.get<GhIssueEvent[]>(`${base}/issues/events?per_page=100`),
    fetchPipelineState(client, base),
    fetchMainDeployedAt(client, base),
  ]);

  const sinceMs = Date.parse(since);
  const issues = rawIssues.map(convertIssue).filter(nonNull);
  const pulls = rawPulls
    .map(convertPull)
    .filter((pull) => Date.parse(pull.updatedAt) >= sinceMs);
  const comments = rawComments.map(convertComment).filter(nonNull);
  const events = rawEvents.map(convertIssueEvent);

  const pullChecks: Record<number, PullChecks> = {};
  await Promise.all(
    pulls.map(async (pull) => {
      pullChecks[pull.number] = await fetchPullChecks(client, base, pull);
    }),
  );

  return { issues, pulls, comments, pullChecks, events, pipeline, mainDeployedAt };
}

/** main の最新コミットの公開ステータスから、いちばん新しい成功した公開の時刻を取る（リポジトリごとに1回） */
async function fetchMainDeployedAt(client: GitHubClient, base: string): Promise<string | null> {
  const status = await client.get<{ statuses?: GhStatus[] }>(`${base}/commits/main/status`);
  return latestSuccessDeployAt((status.statuses ?? []).map(convertStatus));
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
