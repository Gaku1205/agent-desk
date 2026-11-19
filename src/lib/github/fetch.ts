import { cache } from "react";
import type { Env, WatchedRepo } from "../config";
import { checkUserCanRead, forgetInstallation, resolveReadAccess } from "./appToken";
import { GitHubClient, type Fetcher } from "./client";
import { GitHubError, toErrorInfo } from "./errors";
import { mergeRepoParts, planRepoRead, shouldReadFullAfterDeltaError, shouldReadMorePulls } from "./delta";
import {
  convertRepoNodes,
  DELTA_LISTS,
  DELTA_QUERY,
  mainDeployedFrom,
  mergeMainDeployed,
  readDeltaResponse,
  readRepoResponse,
  REPO_QUERY,
  type DeltaList,
  type GqlIssue,
  type GqlPull,
  type MainDeployed,
  type RepoParts,
} from "./graphql";
import { judgePipelineState, type PipelineProbe, type PipelineState } from "../pipelineState";
import type { WatchdogLastRun } from "../watchdogState";
import { cachedRepoData, cachedUserCanRead, snapshotRepoData, type AppRepoData } from "./repoCache";
import { PIPELINE_WORKFLOW_PATH } from "./settings";
import type { CommitStatusData, RepoData, RepoResult, RepoSyncInfo, RunJobsData, RunStepData, WorkflowRunData } from "./types";
import { currentStepFromJobs, stepProbeRunIds } from "../aiActivity";
import { countInProgressJobs, isSleepingRun } from "../lanes/sleeping";

const WINDOW_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Issue・PR それぞれ、ページ送りで取る最大のページ数（1ページ50件＝`REPO_PAGE_SIZE`。最大500件は今までどおり） */
const MAX_PAGES = 10;

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

  const baseKey = deltaBaseKey(client, base);
  const [read, actions] = await Promise.all([
    readRepoParts(client, owner, repo, { since, cutoffMs, now, known: deltaBases.get(baseKey) }),
    fetchActionsState(client, base, now.getTime()),
  ]);
  const mainDeployed = rememberedMainDeployed(client.memoKey(base), read.mainCommits);

  const data: RepoData = {
    owner,
    ...read.parts,
    pipeline: actions.pipeline,
    mainDeployedAt: mainDeployed.at,
    mainDeployedByContext: mainDeployed.byContext,
    watchdog: actions.watchdog,
    runs: actions.runs,
    ...(read.isTemplate === undefined ? {} : { isTemplate: read.isTemplate }),
    sync: read.sync,
  };
  rememberDeltaBase(baseKey, data);
  const { runSteps, runJobs } = await fetchRunJobs(client, base, data);
  if (runSteps.length === 0 && runJobs.length === 0) return data;
  return {
    ...data,
    ...(runSteps.length > 0 ? { runSteps } : {}),
    ...(runJobs.length > 0 ? { runJobs } : {}),
  };
}

/** 差分の読みの元（前に読んだ結果）を覚えておく件数の上限（超えたら古い物から捨てる） */
export const DELTA_BASE_MAX_ENTRIES = 50;

/**
 * 差分の読みの元：リポジトリごとに、このインスタンスが最後に読んだ（またはキャッシュから受け取った）結果。
 * サーバーのメモリ。キーは「トークン（App はインストール）のハッシュ＋リポジトリ」（`GitHubClient.memoKey`）。再起動で消えてよい（そのときは全部を読む）
 */
const deltaBases = new Map<string, RepoData>();

/** テスト用：覚えている物を空にする */
export const deltaBaseCacheForTest = { clear: (): void => deltaBases.clear() };

function deltaBaseKey(client: GitHubClient, base: string): string {
  return client.memoKey(`${base}#delta`);
}

/** 差分の読みの元として覚える。もっと新しく読んだ物を覚えていれば、そちらを残す */
function rememberDeltaBase(key: string, data: RepoData): void {
  if (!data.sync) return;
  const known = deltaBases.get(key)?.sync;
  if (known && Date.parse(known.readAt) > Date.parse(data.sync.readAt)) return;
  deltaBases.delete(key);
  deltaBases.set(key, data);
  while (deltaBases.size > DELTA_BASE_MAX_ENTRIES) {
    const oldest = deltaBases.keys().next();
    if (oldest.done) break;
    deltaBases.delete(oldest.value);
  }
}

/**
 * キャッシュ（ほかのインスタンスが読んだ物もある）から受け取った結果を、差分の読みの元として覚える。
 * 次にそのリポジトリが変わったとき、このインスタンスでも差分だけを読めるようにするため
 */
export function rememberRepoData(client: GitHubClient, { owner, repo }: WatchedRepo, data: RepoData): void {
  rememberDeltaBase(deltaBaseKey(client, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`), data);
}

type ReadParts = {
  parts: RepoParts;
  isTemplate: boolean | undefined;
  mainCommits: CommitStatusData[][] | null;
  sync: RepoSyncInfo;
};

/**
 * Issue・PR とそれに付く物を読む。前の結果があれば差分だけを読んで混ぜ（`planRepoRead`）、無い・6時間たった・
 * 差分の読みが失敗したときは、全部を読む
 */
async function readRepoParts(
  client: GitHubClient,
  owner: string,
  name: string,
  options: { since: string; cutoffMs: number; now: Date; known: RepoData | undefined },
): Promise<ReadParts> {
  const { since, cutoffMs, now, known } = options;
  const readAt = now.toISOString();
  const plan = planRepoRead(known?.sync, now.getTime(), cutoffMs);
  if (plan.mode === "delta" && known?.sync) {
    try {
      const nodes = await fetchDeltaNodes(client, owner, name, { sinceMs: plan.sinceMs, windowSince: since, cutoffMs });
      const touched = new Set([...nodes.issues, ...nodes.pulls].map((node) => node.number));
      const delta = convertRepoNodes(nodes.issues, nodes.pulls, cutoffMs);
      return {
        parts: mergeRepoParts(known, delta, touched, cutoffMs),
        isTemplate: nodes.isTemplate ?? known.isTemplate,
        mainCommits: nodes.mainCommits,
        sync: { mode: "delta", readAt, fullAt: known.sync.fullAt, count: nodes.count },
      };
    } catch (error) {
      if (!shouldReadFullAfterDeltaError(error instanceof GitHubError ? error.kind : null)) throw error;
    }
  }
  const nodes = await fetchRepoNodes(client, owner, name, since, cutoffMs);
  return {
    parts: convertRepoNodes(nodes.issues, nodes.pulls, cutoffMs, nodes.waiting),
    isTemplate: nodes.isTemplate,
    mainCommits: nodes.mainCommits,
    sync: { mode: "full", readAt, fullAt: readAt, count: nodes.issues.length + nodes.pulls.length + nodes.waiting.length },
  };
}

/** 差分の読みで、続きのページが要るのに最大のページ数を超えた（全部を読み直す） */
class DeltaOverflowError extends Error {}

/** 同じ番号の物は、先に出た物だけを残す */
function uniqueByNumber<T extends { number: number }>(nodes: T[]): T[] {
  const seen = new Set<number>();
  return nodes.filter((node) => (seen.has(node.number) ? false : (seen.add(node.number), true)));
}

/**
 * 差分の読み（`DELTA_QUERY`）。`sinceMs` より後に更新された Issue・PR と、直近14日の開いている Issue・PR を取る。
 * Issue は続きがあれば、PR は続きがあって、そのページのいちばん古い物が境目（更新された物は `sinceMs`、開いている物は直近14日）
 * 以降なら、続きの要る一覧だけを問い合わせる。どれかが最大のページ数を超えたら失敗にする（全部を読み直す）
 */
async function fetchDeltaNodes(
  client: GitHubClient,
  owner: string,
  name: string,
  { sinceMs, windowSince, cutoffMs }: { sinceMs: number; windowSince: string; cutoffMs: number },
): Promise<{
  isTemplate: boolean | undefined;
  issues: GqlIssue[];
  pulls: GqlPull[];
  mainCommits: CommitStatusData[][] | null;
  count: number;
}> {
  const nodes: Record<DeltaList, (GqlIssue | GqlPull)[]> = { recentIssues: [], openIssues: [], recentPulls: [], openPulls: [] };
  const after: Record<DeltaList, string | null> = { recentIssues: null, openIssues: null, recentPulls: null, openPulls: null };
  const want: Record<DeltaList, boolean> = { recentIssues: true, openIssues: true, recentPulls: true, openPulls: true };
  const pages: Record<DeltaList, number> = { recentIssues: 0, openIssues: 0, recentPulls: 0, openPulls: 0 };
  const pullSince: Record<"recentPulls" | "openPulls", number> = { recentPulls: sinceMs, openPulls: cutoffMs };
  let isTemplate: boolean | undefined;
  let mainCommits: CommitStatusData[][] | null = null;
  for (let first = true; DELTA_LISTS.some((list) => want[list]); first = false) {
    const read = readDeltaResponse(
      await client.graphql(DELTA_QUERY, {
        owner,
        name,
        since: new Date(sinceMs).toISOString(),
        windowSince,
        recentIssuesAfter: after.recentIssues,
        openIssuesAfter: after.openIssues,
        recentPullsAfter: after.recentPulls,
        openPullsAfter: after.openPulls,
        withRecentIssues: want.recentIssues,
        withOpenIssues: want.openIssues,
        withRecentPulls: want.recentPulls,
        withOpenPulls: want.openPulls,
        withMain: first,
      }),
    );
    if (!read) throw new GitHubError("not_found");
    if (first) {
      isTemplate = read.isTemplate;
      mainCommits = read.mainCommits;
    }
    for (const list of DELTA_LISTS) {
      if (!want[list]) continue;
      pages[list]++;
      const page = read[list];
      const pageNodes = page?.nodes ?? [];
      nodes[list].push(...pageNodes);
      after[list] = page?.next ?? null;
      const more =
        after[list] !== null &&
        (list === "recentPulls" || list === "openPulls"
          ? shouldReadMorePulls(pageNodes.at(-1)?.updatedAt, pullSince[list])
          : true);
      if (more && pages[list] >= MAX_PAGES) throw new DeltaOverflowError("delta read needs too many pages");
      want[list] = more;
    }
  }
  const count = DELTA_LISTS.reduce((sum, list) => sum + nodes[list].length, 0);
  return {
    isTemplate,
    issues: uniqueByNumber([...nodes.recentIssues, ...nodes.openIssues] as GqlIssue[]),
    pulls: uniqueByNumber([...nodes.recentPulls, ...nodes.openPulls] as GqlPull[]),
    mainCommits,
    count,
  };
}

/**
 * 動いている実行のジョブ（`actions/runs/{run_id}/jobs`）を読み、2つを取る：
 * 今のステップ名（「AIが今していること」。`stepProbeRunIds` の実行だけ）と、動いているジョブの数
 * （寝ている目覚ましを除く、実行中の実行すべて。Slots & Queue の `Actions jobs`）。同じ実行は1回だけ読む。
 * ETag つきで取る（変わっていなければ回数制限に数えられない）。取れなかった物は捨てる（ほかは落とさない）
 */
async function fetchRunJobs(
  client: GitHubClient,
  base: string,
  data: RepoData,
): Promise<{ runSteps: RunStepData[]; runJobs: RunJobsData[] }> {
  const probe = new Set(stepProbeRunIds(data));
  const ids = new Set(probe);
  for (const run of data.runs ?? []) {
    if (run.status === "in_progress" && typeof run.id === "number" && !isSleepingRun(run)) ids.add(run.id);
  }
  const read = await Promise.all(
    [...ids].map(async (runId) => {
      try {
        const raw = await client.get<unknown>(`${base}/actions/runs/${runId}/jobs?filter=latest&per_page=100`);
        const inProgress = countInProgressJobs(raw);
        return {
          step: probe.has(runId) ? currentStepFromJobs(runId, raw) : null,
          jobs: inProgress === null ? null : { runId, inProgress },
        };
      } catch {
        return { step: null, jobs: null };
      }
    }),
  );
  return {
    runSteps: read.map((item) => item.step).filter((step): step is RunStepData => step !== null),
    runJobs: read.map((item) => item.jobs).filter((jobs): jobs is RunJobsData => jobs !== null),
  };
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
  waiting: GqlIssue[];
  mainCommits: CommitStatusData[][] | null;
}> {
  const issues: GqlIssue[] = [];
  let waiting: GqlIssue[] = [];
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
      waiting = read.waiting;
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
  return { isTemplate, issues, pulls, waiting, mainCommits };
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
    name?: unknown;
    run_started_at?: unknown;
    created_at?: unknown;
  };
  if (typeof run.status !== "string" || typeof run.updated_at !== "string") return null;
  if (Number.isNaN(Date.parse(run.updated_at))) return null;
  // 始まった時刻（Slots & Queue の経過時間）。読めなければ持たない
  const started = [run.run_started_at, run.created_at].find(
    (value): value is string => typeof value === "string" && !Number.isNaN(Date.parse(value)),
  );
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
    ...(typeof run.name === "string" && run.name.trim() !== "" ? { name: run.name.trim() } : {}),
    ...(started ? { startedAt: started } : {}),
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
        // キャッシュから受け取った物（ほかのインスタンスが読んだ物もある）も、次の差分の読みの元にする
        rememberRepoData(client, repo, data);
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
const fetchRepoOnce = cache(async (token: string, repoKey: string): Promise<RepoResult> => {
  const [result] = await fetchAllRepos(token, [JSON.parse(repoKey) as WatchedRepo], { readAppData: cachedRepoData });
  return result;
});

/**
 * 1リポジトリの取得結果。リポジトリのページが「自分の分だけ先に」取るときに使う。
 * 同じリクエストの中で `getRepoResults`（全部）と同じ結果を使い回すので、GitHub の呼び出しは増えない
 */
export function getRepoResult(token: string, repo: WatchedRepo): Promise<RepoResult> {
  return fetchRepoOnce(token, JSON.stringify({ owner: repo.owner, repo: repo.repo }));
}

export function getRepoResults(token: string, repos: WatchedRepo[]): Promise<RepoResult[]> {
  return Promise.all(repos.map((repo) => getRepoResult(token, repo)));
}

/**
 * 覚えている最後の結果（古くてよい）。新しい結果（`getRepoResult`）が遅いときに、先に画面に出す（docs/spec.md の「全部のリポジトリを待つページ」）。
 * App の鍵で読んだ結果だけを覚える（覚えた物を見せるのは、ログインした人のトークンで読めると確かめたリポジトリだけ。「読み取りの鍵」と同じ決まり）。
 * 覚えている物が無い・見せてよいか確かめられないときは null。GitHub の呼び出しは増えない（新しい結果は `getRepoResult` を使い回す）
 */
const staleRepoOnce = cache(async (token: string, repoKey: string): Promise<RepoResult | null> => {
  const repo = JSON.parse(repoKey) as WatchedRepo;
  if (!(await cachedUserCanRead(token, repo, () => checkUserCanRead(token, repo)))) return null;
  // 新しい結果が App の鍵で読めたときだけ、覚えている物を書き直す（読めなかった・別の鍵で読んだときは、前の物を残す）
  const fresh = fetchRepoOnce(token, repoKey).then((result): AppRepoData => {
    if (result.ok && result.readSource === "app" && result.changeMark) {
      return { data: result.data, changeMark: result.changeMark };
    }
    throw new Error("no app data to remember");
  });
  fresh.catch(() => undefined);
  const known = await snapshotRepoData(repo, fresh);
  if (!known) return null;
  return { owner: repo.owner, repo: repo.repo, ok: true, data: known.data, readSource: "app", changeMark: known.changeMark };
});

export function getStaleRepoResult(token: string, repo: WatchedRepo): Promise<RepoResult | null> {
  return staleRepoOnce(token, JSON.stringify({ owner: repo.owner, repo: repo.repo }));
}
