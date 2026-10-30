import { unstable_cache, updateTag } from "next/cache";
import { repoChangeKey, type ChangeMarks } from "../changeMarks";
import { getSettingsRepo, getWatchedRepos, parseRepoList, type Env, type WatchedRepo } from "../config";
import { decideRefetch, type RefetchDecision } from "../refetchLimit";
import { repoTag } from "../webhook";
import { resolveAppAccess } from "./appToken";
import { GitHubClient } from "./client";
import { readVariable, WATCHED_REPOS_VARIABLE } from "./settings";
import type { RepoData } from "./types";

// Next.js のキャッシュ（`unstable_cache`。タグで無効にでき、Vercel では全部のインスタンスに効く）に、
// App の鍵で読んだリポジトリのデータと「変わった」印を覚える（docs/spec.md の「更新」）。サーバーだけで使う。
// Cache Components（`use cache`・`cacheTag`）は画面全体の作りが変わるので使わず、同じタグの仕組みの `unstable_cache` を使う。

/** キャッシュの寿命（秒）。Webhook が届かなかったときの保険 */
export const REPO_CACHE_SECONDS = 5 * 60;
/** Webhook が見る「設定の監視リポジトリ」のタグ。設定を保存したら無効にする */
export const WATCHED_REPOS_TAG = "watched-repos";

/** データの形が変わった公開の後に、前の公開で覚えた物を使わないため */
const DEPLOY_KEY = process.env.VERCEL_DEPLOYMENT_ID ?? process.env.VERCEL_GIT_COMMIT_SHA ?? "local";

/** Webhook を使う設定か（`GITHUB_WEBHOOK_SECRET` があるか） */
export function isWebhookEnabled(env: Env = process.env): boolean {
  return Boolean(env.GITHUB_WEBHOOK_SECRET);
}

/** そのリポジトリを下限を無視して取り直すためのタグ（手で押す「同期」・ボタン操作の後） */
function forceTag(repo: WatchedRepo): string {
  return `force:${repoChangeKey(repo)}`.toLowerCase();
}

/** 取り直した時刻など。インスタンスごとにメモリに覚える（インスタンスをまたぐ厳密さは求めない） */
type RepoState = {
  data: RepoData;
  /** 前に取った時刻（取り始めた時刻、ミリ秒） */
  fetchedAt: number;
  /** そのとき見えていた「最後に変わった時刻」（ミリ秒）。画面に見せる印になる */
  changedAt: number;
  /** そのとき見えていた「すぐ取り直す」印 */
  forcedAt: number;
};
const repoStates = new Map<string, RepoState>();

/** 「最後に変わった時刻」（ミリ秒）。タグが無効になった後に初めて読んだ時刻で、次に無効になるまで変わらない */
function readChangedAt(repo: WatchedRepo): Promise<number> {
  return unstable_cache(async () => Date.now(), ["repo-changed-at-ms", repoChangeKey(repo)], {
    tags: [repoTag(repo)],
  })();
}

/** 「すぐ取り直す」印。`invalidateRepoNow` の後に初めて読んだ時刻 */
function readForcedAt(repo: WatchedRepo): Promise<number> {
  return unstable_cache(async () => Date.now(), ["repo-forced-at-ms", repoChangeKey(repo)], {
    tags: [forceTag(repo)],
  })();
}

type Timeline = { state: RepoState | undefined; changedAt: number; forcedAt: number; decision: RefetchDecision };

async function readTimeline(repo: WatchedRepo, now: number): Promise<Timeline> {
  const [changedAt, forcedAt] = await Promise.all([readChangedAt(repo), readForcedAt(repo)]);
  const state = repoStates.get(repoChangeKey(repo));
  // 「すぐ取り直す」印が進んでいたら、前に取った時刻は無かったことにする（下限を無視）
  const lastFetchedAt = state && state.forcedAt === forcedAt ? state.fetchedAt : null;
  return { state, changedAt, forcedAt, decision: decideRefetch({ lastFetchedAt, lastChangedAt: changedAt, now }) };
}

/** 変わっているが、前に取ってから15秒たっていないか（前のデータがあるときだけ） */
function isThrottled({ state, decision }: Timeline): boolean {
  return state !== undefined && !decision.refetch && decision.waitSeconds > 0;
}

/**
 * App の鍵で読むリポジトリのデータを、タグ `repo:<owner>/<repo>` つきで最大5分覚える。
 * キーはリポジトリだけ（鍵は1時間で替わるので入れない。App の鍵で読むのは、ログインした人が読めると確かめた物だけ）。
 * 変わった知らせでタグが無効になっても、前に取ってから15秒たつまでは取り直さず、前のデータを返す
 * （`decideRefetch`。15秒の間の知らせは、たった後の1回にまとまる）
 */
export async function cachedRepoData(repo: WatchedRepo, load: () => Promise<RepoData>): Promise<RepoData> {
  const timeline = await readTimeline(repo, Date.now());
  if (timeline.state && isThrottled(timeline)) return timeline.state.data;

  let loadedAt: number | null = null;
  const data = await unstable_cache(
    () => {
      loadedAt = Date.now();
      return load();
    },
    ["repo-data", DEPLOY_KEY, repoChangeKey(repo)],
    { tags: [repoTag(repo)], revalidate: REPO_CACHE_SECONDS },
  )();
  repoStates.set(repoChangeKey(repo), {
    data,
    // 自分で取ったときは取り始めた時刻。ほかのインスタンスが取った物を使ったときは、見えた変化の時刻
    fetchedAt: loadedAt ?? Math.max(timeline.state?.fetchedAt ?? 0, timeline.changedAt),
    changedAt: timeline.changedAt,
    forcedAt: timeline.forcedAt,
  });
  return data;
}

/** 手で押す「同期」・ボタン操作の後：下限を無視して、次の表示ですぐ取り直す */
export function invalidateRepoNow(repo: WatchedRepo): void {
  updateTag(repoTag(repo));
  updateTag(forceTag(repo));
}

/**
 * 画面に見せる「変わった」印：そのリポジトリが最後に変わった時刻。GitHub には問い合わせない。
 * 取り直しを待っている間（前に取ってから15秒たっていない）は進めず、取り直してよい時になって初めて進む
 * （印だけ先に進むと、画面が古いデータのまま次の変化を待ってしまうため）
 */
export async function getChangeMark(repo: WatchedRepo, now: number = Date.now()): Promise<string> {
  const timeline = await readTimeline(repo, now);
  const at = timeline.state && isThrottled(timeline) ? timeline.state.changedAt : timeline.changedAt;
  return new Date(at).toISOString();
}

/** 監視リポジトリごとの印 */
export async function getChangeMarks(repos: WatchedRepo[]): Promise<ChangeMarks> {
  const entries = await Promise.all(
    repos.map(async (repo) => [repoChangeKey(repo), await getChangeMark(repo)] as const),
  );
  return Object.fromEntries(entries);
}

/** 設定の Variable を App の鍵で読んだ結果。`known` が false のときは読めなかった（分からない） */
type SettingsVariable = { known: boolean; value: string | null };

async function readSettingsVariable(settingsRepo: WatchedRepo): Promise<SettingsVariable> {
  const access = await resolveAppAccess(settingsRepo).catch(() => null);
  if (!access) return { known: false, value: null };
  try {
    const client = new GitHubClient(access.token, undefined, { source: "app", keyId: access.keyId });
    return { known: true, value: await readVariable(client, settingsRepo, WATCHED_REPOS_VARIABLE) };
  } catch {
    return { known: false, value: null };
  }
}

/**
 * Webhook が見る監視リポジトリ：環境変数 `WATCHED_REPOS` と、設定の監視リポジトリ（App の鍵で読み、最大5分覚える）。
 * 設定の保存先があるのに読めないときは null（分からない）
 */
export async function loadWebhookWatchedRepos(env: Env = process.env): Promise<WatchedRepo[] | null> {
  const fromEnv = getWatchedRepos(env);
  const settingsRepo = getSettingsRepo(env);
  if (!settingsRepo) return fromEnv;
  const variable = await unstable_cache(
    () => readSettingsVariable(settingsRepo),
    ["webhook-watched-repos", repoChangeKey(settingsRepo)],
    { tags: [WATCHED_REPOS_TAG], revalidate: REPO_CACHE_SECONDS },
  )();
  if (!variable.known) return null;
  return [...fromEnv, ...parseRepoList(variable.value)];
}
