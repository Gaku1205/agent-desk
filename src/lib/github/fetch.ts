import { cache } from "react";
import type { Env, WatchedRepo } from "../config";
import { forgetInstallation, resolveReadAccess } from "./appToken";
import { GitHubClient, type Fetcher } from "./client";
import { GitHubError, toErrorInfo } from "./errors";
import {
  convertRepoNodes,
  mainDeployedFrom,
  mergeMainDeployed,
  readRepoResponse,
  REPO_QUERY,
  type GqlIssue,
  type GqlPull,
  type MainDeployed,
} from "./graphql";
import { judgePipelineState, type PipelineProbe, type PipelineState } from "../pipelineState";
import type { WatchdogLastRun } from "../watchdogState";
import { cachedRepoData, type AppRepoData } from "./repoCache";
import { PIPELINE_WORKFLOW_PATH } from "./settings";
import type { CommitStatusData, RepoData, RepoResult, RunStepData, WorkflowRunData } from "./types";
import { currentStepFromJobs, stepProbeRunIds } from "../aiActivity";

const WINDOW_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Issue・PR それぞれ、ページ送りで取る最大のページ数（1ページ100件） */
const MAX_PAGES = 5;

/**
 * 1リポジトリぶんのデータ（直近14日）を取る（docs/spec.md の「データの取得」）。
 * GraphQL を1回（ページ送りのときだけ増える）と、5分ごとの Actions の runs（REST）。
 * GraphQL が失敗したら GitHubError を投げる
 */
export async function fetchRepoData(
  client: GitHubClient,
  { owner, repo }: WatchedRepo,
  now: Date = new Date(),
): Promise<RepoData> {
  const base = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  // 直近14日の境目。結果の絞り込みに使う
  const cutoffMs = now.getTime() - WINDOW_DAYS * DAY_MS;
  // 問い合わせの since は日の始め（UTC の0時）に切り下げ、取ったあとで直近14日に絞り直す
  const since = new Date(Math.floor(cutoffMs / DAY_MS) * DAY_MS).toISOString();

  const [nodes, actions] = await Promise.all([
    fetchRepoNodes(client, owner, repo, since, cutoffMs),
    fetchActionsState(client, base, now.getTime()),
  ]);
  const mainDeployed = rememberedMainDeployed(client.memoKey(base), nodes.mainCommits);

  const data: RepoData = {
    ...convertRepoNodes(nodes.issues, nodes.pulls, cutoffMs),
    pipeline: actions.pipeline,
    mainDeployedAt: mainDeployed.at,
    mainDeployedByContext: mainDeployed.byContext,
    watchdog: actions.watchdog,
    runs: actions.runs,
    ...(nodes.isTemplate === undefined ? {} : { isTemplate: nodes.isTemplate }),
  };
  const runSteps = await fetchRunSteps(client, base, stepProbeRunIds(data));
  return runSteps.length > 0 ? { ...data, runSteps } : data;
}

/**
 * 動いている実行の今のステップ名（「AIが今していること」。作業中のコメントが無い物だけ）。
 * ETag つきで取る（変わっていなければ回数制限に数えられない）。取れなかった物は捨てる（ほかは落とさない）
 */
async function fetchRunSteps(client: GitHubClient, base: string, runIds: number[]): Promise<RunStepData[]> {
  const steps = await Promise.all(
    runIds.map(async (runId) => {
      try {
        const raw = await client.get<unknown>(`${base}/actions/runs/${runId}/jobs?filter=latest&per_page=30`);
        return currentStepFromJobs(runId, raw);
      } catch {
        return null;
      }
    }),
  );
  return steps.filter((step): step is RunStepData => step !== null);
}

/**
 * GraphQL で Issue・PR（とコメント・チェックなど）と main の公開ステータスを取る。
 * Issue は続きがあれば、PR は続きがあってそのページのいちばん古い物が直近14日の中なら、続きだけを問い合わせる
 */
async function fetchRepoNodes(
  client: GitHubClient,
  owner: string,
  name: string,
  since: string,
  cutoffMs: number,
): Promise<{
  isTemplate: boolean | undefined;
  issues: GqlIssue[];
  pulls: GqlPull[];
  mainCommits: CommitStatusData[][] | null;
}> {
  const issues: GqlIssue[] = [];
  const pulls: GqlPull[] = [];
  let isTemplate: boolean | undefined;
  let mainCommits: CommitStatusData[][] | null = null;
  let issuesAfter: string | null = null;
  let pullsAfter: string | null = null;
  let issuePages = 0;
  let pullPages = 0;
  let withIssues = true;
  let withPulls = true;
  for (let first = true; withIssues || withPulls; first = false) {
    const read = readRepoResponse(
      await client.graphql(REPO_QUERY, {
        owner,
        name,
        since,
        issuesAfter,
        pullsAfter,
        withIssues,
        withPulls,
        withMain: first,
      }),
    );
    if (!read) throw new GitHubError("not_found");
    if (first) {
      isTemplate = read.isTemplate;
      mainCommits = read.mainCommits;
    }
    if (withIssues) {
      issuePages++;
      issues.push(...(read.issues?.nodes ?? []));
      issuesAfter = read.issues?.next ?? null;
      withIssues = issuesAfter !== null && issuePages < MAX_PAGES;
    }
    if (withPulls) {
      pullPages++;
      const pagePulls = read.pulls?.nodes ?? [];
      pulls.push(...pagePulls);
      const oldest = pagePulls.at(-1);
      pullsAfter = read.pulls?.next ?? null;
      withPulls =
        pullsAfter !== null &&
        pullPages < MAX_PAGES &&
        oldest !== undefined &&
        Date.parse(oldest.updatedAt) >= cutoffMs;
    }
  }
  return { isTemplate, issues, pulls, mainCommits };
}

/** 前回取れた「main の最後の公開の成功の時刻」を覚えておく件数の上限（超えたら古い物から捨てる） */
export const MAIN_DEPLOYED_CACHE_MAX_ENTRIES = 100;

/** サーバーのメモリ。キーは「トークンのハッシュ＋リポジトリ」（`GitHubClient.memoKey`） */
const lastMainDeployedAt = new Map<string, MainDeployed>();

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
 * main の直近のコミット（30件）の公開ステータスから、最後に公開が成功した時刻を決める。
 * 前回見つけた context ごとの成功とは、context ごとに新しい方で合わせる（範囲の外に出た成功を捨てない）。
 * main が取れなかった（`commits` が null）ときは、そのリポジトリで前回取れた値を使う（無ければ null）
 */
export function rememberedMainDeployed(key: string, commits: CommitStatusData[][] | null): MainDeployed {
  const previous = lastMainDeployedAt.get(key);
  if (commits === null) return previous ?? { at: null, byContext: {} };
  const merged = mergeMainDeployed(previous, mainDeployedFrom(commits));
  rememberMainDeployedAt(key, merged);
  return merged;
}

/** Actions の runs（パイプラインの状態・見張り役の最後の実行）を取り直す間隔 */
export const ACTIONS_REFRESH_MS = 5 * 60_000;
/** 覚えておく件数の上限（超えたら古い物から捨てる） */
export const ACTIONS_CACHE_MAX_ENTRIES = 100;

type ActionsState = {
  at: number;
  pipeline: PipelineState;
  watchdog: WatchdogLastRun;
  runs: WorkflowRunData[] | null;
};

/** サーバーのメモリ。キーは「トークンのハッシュ＋リポジトリ」（`GitHubClient.memoKey`） */
const actionsStates = new Map<string, ActionsState>();

/** テスト用：覚えている物を空にする */
export const actionsCacheForTest = { clear: (): void => actionsStates.clear() };

/**
 * パイプラインの状態と見張り役の最後の実行（GraphQL で取れないので REST）。
 * リポジトリごとに5分に1回だけ取り直し、間は前の値を使う
 */
async function fetchActionsState(
  client: GitHubClient,
  base: string,
  nowMs: number,
): Promise<ActionsState> {
  const key = client.memoKey(`${base}#actions`);
  const known = actionsStates.get(key);
  if (known && nowMs >= known.at && nowMs - known.at < ACTIONS_REFRESH_MS) return known;
  const [pipeline, watchdog, runs] = await Promise.all([
    fetchPipelineState(client, base),
    fetchWatchdogLastRun(client, base),
    fetchWorkflowRuns(client, base),
  ]);
  const state: ActionsState = { at: nowMs, pipeline, watchdog, runs };
  actionsStates.delete(key);
  actionsStates.set(key, state);
  while (actionsStates.size > ACTIONS_CACHE_MAX_ENTRIES) {
    const oldest = actionsStates.keys().next();
    if (oldest.done) break;
    actionsStates.delete(oldest.value);
  }
  return state;
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

/** 1件の実行を今の型に変える。形が違えば null */
export function toWorkflowRun(raw: unknown): WorkflowRunData | null {
  if (typeof raw !== "object" || raw === null) return null;
  const run = raw as {
    id?: unknown;
    status?: unknown;
    head_branch?: unknown;
    display_title?: unknown;
    pull_requests?: unknown;
    updated_at?: unknown;
  };
  if (typeof run.status !== "string" || typeof run.updated_at !== "string") return null;
  if (Number.isNaN(Date.parse(run.updated_at))) return null;
  const pullNumbers = Array.isArray(run.pull_requests)
    ? run.pull_requests
        .map((pull) => (pull as { number?: unknown } | null)?.number)
        .filter((number): number is number => typeof number === "number")
    : [];
  return {
    ...(typeof run.id === "number" ? { id: run.id } : {}),
    status: run.status,
    headBranch: typeof run.head_branch === "string" ? run.head_branch : null,
    displayTitle: typeof run.display_title === "string" ? run.display_title : "",
    pullNumbers,
    updatedAt: run.updated_at,
  };
}

/** ランプ用に取る実行：実行中・待機中（各100件まで）と、最近の実行（最後に動いた時刻を知るため。100件まで） */
const RUN_QUERIES = ["?status=in_progress&per_page=100", "?status=queued&per_page=100", "?per_page=100"];

/**
 * Actions の実行（ランプの「動作中」「止まっているかも」に使う）。1つでも取れなかったら null
 * （取れなかったときは、緑にも「止まっているかも」の赤にもしない）
 */
async function fetchWorkflowRuns(client: GitHubClient, base: string): Promise<WorkflowRunData[] | null> {
  try {
    const pages = await Promise.all(
      RUN_QUERIES.map((query) => client.get<{ workflow_runs?: unknown }>(`${base}/actions/runs${query}`)),
    );
    const runs: WorkflowRunData[] = [];
    for (const page of pages) {
      if (!Array.isArray(page?.workflow_runs)) return null;
      for (const raw of page.workflow_runs) {
        const run = toWorkflowRun(raw);
        if (run) runs.push(run);
      }
    }
    return runs;
  } catch {
    return null;
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
    readAppData?: (repo: WatchedRepo, load: () => Promise<RepoData>) => Promise<AppRepoData>;
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
        if (!options.readAppData) return { owner, repo: name, ok: true, data: await load(), readSource };
        const { data, changeMark } = await options.readAppData(repo, load);
        return { owner, repo: name, ok: true, data, readSource, changeMark };
      } catch (error) {
        // App の鍵で権限なし・見つからないなら、記憶を消して、ログインした人のトークンで1回だけ読み直す
        if (access && error instanceof GitHubError && (error.kind === "forbidden" || error.kind === "not_found")) {
          forgetInstallation(repo);
          try {
            const data = await fetchRepoData(userClient, repo, options.now);
            return { owner, repo: name, ok: true, data, readSource: "user" };
          } catch (retryError) {
            return { owner, repo: name, ok: false, error: toErrorInfo(retryError), readSource: "user" };
          }
        }
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
