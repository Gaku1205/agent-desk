import { cache } from "react";
import type { Env, WatchedRepo } from "../config";
import { resolveReadAccess } from "./appToken";
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
import { isDeployStatus } from "../deployStatus";
import { deployState, isIssueLinkedPull, latestSuccessDeployByContext } from "../status";
import type { WatchdogLastRun } from "../watchdogState";
import { cachedRepoData } from "./repoCache";
import { PIPELINE_WORKFLOW_PATH } from "./settings";
import type { CommitStatusData, PullChecks, PullData, RepoData, RepoResult } from "./types";

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

  const [rawIssues, rawPulls, rawComments, rawEvents, pipeline, mainDeployed, watchdog, isTemplate] = await Promise.all([
    client.getAll<GhIssue>(
      `${base}/issues?state=all&since=${since}&sort=updated&direction=desc&per_page=100`,
    ),
    client.getAll<GhPull>(`${base}/pulls?state=all&sort=updated&direction=desc&per_page=100`),
    client.getAll<GhComment>(`${base}/issues/comments?since=${since}&per_page=100`),
    client.get<GhIssueEvent[]>(`${base}/issues/events?per_page=100`),
    fetchPipelineState(client, base),
    fetchMainDeployedAt(client, base),
    fetchWatchdogLastRun(client, base),
    fetchIsTemplate(client, base),
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

  // チェックを取るのは、Issueに紐づく「開いているPR」と「マージ済みPR」だけ（回数制限を使い切らないため）
  const pullChecks: Record<number, PullChecks> = {};
  await Promise.all(
    pulls.map(async (pull) => {
      if (!isIssueLinkedPull(pull) || (pull.state === "closed" && !pull.merged)) return;
      pullChecks[pull.number] = await fetchPullChecks(client, base, pull, now);
    }),
  );

  return {
    issues,
    pulls,
    comments,
    pullChecks,
    events,
    pipeline,
    mainDeployedAt: mainDeployed.at,
    mainDeployedByContext: mainDeployed.byContext,
    watchdog,
    ...(isTemplate === undefined ? {} : { isTemplate }),
  };
}

/** `GET /repos/{owner}/{repo}` の `is_template`。調べられなかった（エラー・形が違う）ときは undefined */
async function fetchIsTemplate(client: GitHubClient, base: string): Promise<boolean | undefined> {
  try {
    const repo = await client.get<{ is_template?: unknown }>(base);
    return typeof repo?.is_template === "boolean" ? repo.is_template : undefined;
  } catch {
    return undefined;
  }
}

/** main の直近のコミット（新しい順）を何件まで見るか */
const MAIN_COMMITS_SAMPLE = 10;
/** 前回取れた「main の最後の公開の成功の時刻」を覚えておく件数の上限（超えたら古い物から捨てる） */
export const MAIN_DEPLOYED_CACHE_MAX_ENTRIES = 100;

/** サーバーのメモリ。キーは「トークンのハッシュ＋リポジトリ」（`GitHubClient.memoKey`） */
const lastMainDeployedAt = new Map<string, MainDeployed>();

/** main の最後の公開の成功：全体のいちばん新しい時刻と、context ごとの時刻 */
type MainDeployed = { at: string | null; byContext: Record<string, string> };

function rememberMainDeployedAt(key: string, value: MainDeployed): void {
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
async function fetchMainDeployedAt(client: GitHubClient, base: string): Promise<MainDeployed> {
  const key = client.memoKey(base);
  try {
    const commits = await client.get<{ sha?: unknown }[]>(
      `${base}/commits?sha=main&per_page=${MAIN_COMMITS_SAMPLE}`,
    );
    if (!Array.isArray(commits)) throw new GitHubError("other");
    const byContext: Record<string, string> = {};
    // 見えた公開の context。全部の context で成功が見つかったらやめる
    const seen = new Set<string>();
    for (const commit of commits.slice(0, MAIN_COMMITS_SAMPLE)) {
      if (typeof commit?.sha !== "string") throw new GitHubError("other");
      const status = await client.get<{ statuses?: GhStatus[] }>(
        `${base}/commits/${encodeURIComponent(commit.sha)}/status?per_page=100`,
      );
      const statuses = (status.statuses ?? []).map(convertStatus);
      for (const s of statuses) if (isDeployStatus(s.context)) seen.add(s.context);
      // 新しいコミットで見つかった context は、古いコミットの値で上書きしない
      for (const [context, at] of Object.entries(latestSuccessDeployByContext(statuses))) {
        byContext[context] ??= at;
      }
      if (seen.size > 0 && [...seen].every((context) => context in byContext)) break;
    }
    const found: MainDeployed = { at: Object.values(byContext).sort().at(-1) ?? null, byContext };
    rememberMainDeployedAt(key, found);
    return found;
  } catch {
    return lastMainDeployedAt.get(key) ?? { at: null, byContext: {} };
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

/** 公開済みと決まったマージコミットの公開ステータスを覚えておく件数の上限（超えたら古い物から捨てる） */
export const DEPLOYED_STATUS_CACHE_MAX_ENTRIES = 500;

/** サーバーのメモリ。キーは「トークンのハッシュ＋リポジトリ＋sha」（`GitHubClient.memoKey`） */
const deployedStatuses = new Map<string, CommitStatusData[]>();

function rememberDeployedStatuses(key: string, value: CommitStatusData[]): void {
  deployedStatuses.delete(key);
  deployedStatuses.set(key, value);
  while (deployedStatuses.size > DEPLOYED_STATUS_CACHE_MAX_ENTRIES) {
    const oldest = deployedStatuses.keys().next();
    if (oldest.done) break;
    deployedStatuses.delete(oldest.value);
  }
}

/** テスト用：覚えている物を空にする */
export const deployedStatusCacheForTest = { clear: (): void => deployedStatuses.clear() };

/**
 * PRのチェックを取る。開いているPRは先頭コミットの check-runs だけ。
 * マージ済みのPRはマージコミットの公開ステータスだけ（check-runs は取らず空）。
 * 公開済み（全部成功）と決まったら、同じ sha はもう取らない
 */
async function fetchPullChecks(
  client: GitHubClient,
  base: string,
  pull: PullData,
  now: Date,
): Promise<PullChecks> {
  if (!pull.merged) {
    const runs = await client.get<{ check_runs?: GhCheckRun[] }>(
      `${base}/commits/${encodeURIComponent(pull.headSha)}/check-runs?per_page=100`,
    );
    return { checkRuns: (runs.check_runs ?? []).map(convertCheckRun), statuses: [] };
  }
  if (!pull.mergeCommitSha) return { checkRuns: [], statuses: [] };
  const key = client.memoKey(`${base}/commits/${pull.mergeCommitSha}`);
  const known = deployedStatuses.get(key);
  if (known) return { checkRuns: [], statuses: known };
  const result = await client.get<{ statuses?: GhStatus[] }>(
    `${base}/commits/${encodeURIComponent(pull.mergeCommitSha)}/status?per_page=100`,
  );
  const statuses = (result.statuses ?? []).map(convertStatus);
  if (statuses.length > 0 && deployState(statuses, pull.mergedAt, now).state === "deployed") {
    rememberDeployedStatuses(key, statuses);
  }
  return { checkRuns: [], statuses };
}

/**
 * 監視リポジトリ全部を取る。1つが失敗しても、ほかは取れる（エラーはリポジトリごとに返す）。
 * `readAppData` を渡すと、App の鍵で読むリポジトリはそれを通して取る（キャッシュに覚えるため）
 */
export async function fetchAllRepos(
  token: string,
  repos: WatchedRepo[],
  options: {
    fetcher?: Fetcher;
    now?: Date;
    env?: Env;
    readAppData?: (repo: WatchedRepo, load: () => Promise<RepoData>) => Promise<RepoData>;
  } = {},
): Promise<RepoResult[]> {
  const userClient = new GitHubClient(token, options.fetcher);
  return Promise.all(
    repos.map(async (repo): Promise<RepoResult> => {
      const { owner, repo: name } = repo;
      // 読み取りは、使えるときだけ App のインストールの鍵で行う（無ければログインした人のトークン）
      const access = await resolveReadAccess(token, repo, {
        env: options.env,
        fetcher: options.fetcher,
        nowMs: options.now?.getTime(),
      }).catch(() => null);
      const readSource = access ? "app" : "user";
      try {
        if (!access) {
          const data = await fetchRepoData(userClient, repo, options.now);
          return { owner, repo: name, ok: true, data, readSource };
        }
        const client = new GitHubClient(access.token, options.fetcher, {
          source: "app",
          keyId: access.keyId,
        });
        const load = () => fetchRepoData(client, repo, options.now);
        const data = await (options.readAppData ? options.readAppData(repo, load) : load());
        return { owner, repo: name, ok: true, data, readSource };
      } catch (error) {
        return { owner, repo: name, ok: false, error: toErrorInfo(error), readSource };
      }
    }),
  );
}

/**
 * 1回のリクエスト（サーバーのレンダリング）の中では、同じ引数なら取得結果を使い回す。
 * React の cache は引数を参照で比べるので、リポジトリは文字列にして渡す。
 * App の鍵で読むリポジトリは、Next.js のキャッシュ（`cachedRepoData`。タグ `repo:<owner>/<repo>`）を通す
 */
const fetchAllReposOnce = cache((token: string, reposKey: string) =>
  fetchAllRepos(token, JSON.parse(reposKey) as WatchedRepo[], { readAppData: cachedRepoData }),
);

export function getRepoResults(token: string, repos: WatchedRepo[]): Promise<RepoResult[]> {
  return fetchAllReposOnce(token, JSON.stringify(repos));
}
