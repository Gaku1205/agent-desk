import { revalidateTag, unstable_cache, updateTag } from "next/cache";
import { repoChangeKey, type ChangeMarks } from "../changeMarks";
import { getSettingsRepo, getWatchedRepos, parseRepoList, type Env, type WatchedRepo } from "../config";
import { decideRefetch } from "../refetchLimit";
import { repoTag } from "../webhook";
import { resolveAppAccess } from "./appToken";
import { GitHubClient } from "./client";
import { readVariable, WATCHED_REPOS_VARIABLE } from "./settings";
import type { RepoData } from "./types";

// Next.js のキャッシュ（`unstable_cache`。タグで無効にでき、Vercel では全部のインスタンスに効く）に、
// App の鍵で読んだリポジトリのデータと「変わった」印を覚える（docs/spec.md の「更新」）。サーバーだけで使う。
// Cache Components（`use cache`・`cacheTag`）は画面全体の作りが変わるので使わず、同じタグの仕組みの `unstable_cache` を使う。
// 15秒の下限の判定に使う物も全部キャッシュに置き、サーバーのメモリには覚えない（インスタンスをまたいで同じに効かせるため）。

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

/** 「取り直してよい印」のタグ。Webhook では無効にならない（`/api/changes` と手で押す「同期」・ボタン操作の後だけ） */
function releaseTag(repo: WatchedRepo): string {
  return `release:${repoChangeKey(repo)}`;
}

/** 「最後に変わった時刻」（ミリ秒）。タグが無効になった後に初めて読んだ時刻で、次に無効になるまで変わらない */
function readChangedAt(repo: WatchedRepo): Promise<number> {
  return unstable_cache(async () => Date.now(), ["repo-changed-at-ms", repoChangeKey(repo)], {
    tags: [repoTag(repo)],
  })();
}

/** 取り直してよい印：取り直しを許した「最後に変わった時刻」と、許した時刻（＝前に取った時刻）。ミリ秒 */
type Release = { changedAt: number; releasedAt: number };

/**
 * 取り直してよい印。初めて読むとき（無効にした後も）は、渡した「最後に変わった時刻」と今の時刻になる。
 * `unstable_cache` の中で別の `unstable_cache` を呼ぶと中はキャッシュされないので、「最後に変わった時刻」は先に読んで渡す
 */
function readRelease(repo: WatchedRepo, changedAt: number): Promise<Release> {
  return unstable_cache(
    async (): Promise<Release> => ({ changedAt, releasedAt: Date.now() }),
    ["repo-release-ms", repoChangeKey(repo)],
    { tags: [releaseTag(repo)] },
  )();
}

/** App の鍵で読んだデータと、そのデータに反映済みの「変わった」印（ISO 文字列） */
export type AppRepoData = { data: RepoData; changeMark: string };

/**
 * App の鍵で読むリポジトリのデータを、最大5分覚える。
 * キーはリポジトリと取り直してよい印の「最後に変わった時刻」（鍵は1時間で替わるので入れない。App の鍵で読むのは、
 * ログインした人が読めると確かめた物だけ）。変化ごとに別の入れ物になるので、取得の途中に Webhook が来ても、
 * 保存した瞬間にその無効化が消えることは無い（次の印で取り直される）。
 * 印を進める（取り直してよいか決める）のは `/api/changes`（`getChangeMarks`）だけで、ここは今の印のデータを返す
 */
export async function cachedRepoData(
  repo: WatchedRepo,
  load: () => Promise<RepoData>,
): Promise<AppRepoData> {
  const release = await readRelease(repo, await readChangedAt(repo));
  const data = await unstable_cache(
    () => load(),
    ["repo-data", DEPLOY_KEY, repoChangeKey(repo), String(release.changedAt)],
    { revalidate: REPO_CACHE_SECONDS },
  )();
  return { data, changeMark: new Date(release.changedAt).toISOString() };
}

/** 手で押す「同期」・ボタン操作の後：下限を無視して、次の表示ですぐ取り直す */
export function invalidateRepoNow(repo: WatchedRepo): void {
  updateTag(repoTag(repo));
  updateTag(releaseTag(repo));
}

/**
 * 画面に見せる「変わった」印：取り直してよい印の「最後に変わった時刻」。GitHub には問い合わせない。
 * 印の後に変わっていて、前に取ってから15秒たっていれば、印を進める（`decideRefetch`）。
 * 15秒たっていなければ前の印のまま（15秒の間に何回変わっても、たった後の1回にまとまる）。
 * タグを無効にするので、Route Handler（`/api/changes`）からだけ呼ぶ
 */
export async function getChangeMark(repo: WatchedRepo, now: number = Date.now()): Promise<string> {
  const changedAt = await readChangedAt(repo);
  let release = await readRelease(repo, changedAt);
  const decision = decideRefetch({
    lastFetchedAt: release.releasedAt,
    lastChangedAt: changedAt,
    reflectedChangedAt: release.changedAt,
    now,
  });
  if (decision.refetch) {
    revalidateTag(releaseTag(repo), { expire: 0 });
    release = await readRelease(repo, changedAt);
  }
  return new Date(release.changedAt).toISOString();
}

/** 監視リポジトリごとの印（`/api/changes` から呼ぶ） */
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
