import { gunzipSync, gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { revalidateTag, unstable_cache, updateTag } from "next/cache";
import { after } from "next/server";
import { repoChangeKey, type ChangeMarks } from "../changeMarks";
import { getSettingsRepo, getWatchedRepos, parseRepoList, type Env, type WatchedRepo } from "../config";
import { decideRefetch, isSettledChange, refetchPeriod, type RefetchRecord } from "../refetchLimit";
import { shareInFlight } from "../inFlight";
import { shouldRememberSnapshot } from "../staleSnapshot";
import { repoTag, urgentTag } from "../webhook";
import { resolveAppAccess } from "./appToken";
import { GitHubClient } from "./client";
import { readVariable, WATCHED_REPOS_VARIABLE } from "./settings";
import type { RepoData } from "./types";

// Next.js のキャッシュ（`unstable_cache`。タグで無効にでき、Vercel では全部のインスタンスに効く）に、
// App の鍵で読んだリポジトリのデータと「変わった」印を覚える（docs/spec.md の「更新」）。サーバーだけで使う。
// Cache Components（`use cache`・`cacheTag`）は画面全体の作りが変わるので使わず、同じタグの仕組みの `unstable_cache` を使う。
// 取り直しの持ち分の判定に使う物も全部キャッシュに置き、サーバーのメモリには覚えない（インスタンスをまたいで同じに効かせるため）。

/** キャッシュの寿命（秒）。Webhook が届かなかったときの保険 */
export const REPO_CACHE_SECONDS = 5 * 60;
/** 「設定の監視リポジトリ」を覚えた物のタグ（画面が使う物・Webhook が見る物）。設定を保存した・自動で足したら無効にする */
export const WATCHED_REPOS_TAG = "watched-repos";
/**
 * 画面が使う「設定の監視リポジトリ」（Variable の値）を覚える長さ（秒）。過ぎた物は、覚えた値をすぐ返して裏で読み直す
 * （GitHub の画面などで外から書き換えた分が、次の次の表示で出る）
 */
export const WATCHED_VARIABLE_CACHE_SECONDS = 60;

/** データの形が変わった公開の後に、前の公開で覚えた物を使わないため */
const DEPLOY_KEY = process.env.VERCEL_DEPLOYMENT_ID ?? process.env.VERCEL_GIT_COMMIT_SHA ?? "local";

/** Webhook を使う設定か（`GITHUB_WEBHOOK_SECRET` があるか） */
export function isWebhookEnabled(env: Env = process.env): boolean {
  return Boolean(env.GITHUB_WEBHOOK_SECRET);
}

/** 手で押す「同期」・ボタン操作の印のタグ。Webhook では無効にならない（手で押す「同期」・ボタン操作の後だけ） */
function releaseTag(repo: WatchedRepo): string {
  return `release:${repoChangeKey(repo)}`;
}

/** 「最後に変わった時刻」（ミリ秒）。タグが無効になった後に初めて読んだ時刻で、次に無効になるまで変わらない */
function readChangedAt(repo: WatchedRepo): Promise<number> {
  return unstable_cache(async () => Date.now(), ["repo-changed-at-ms", repoChangeKey(repo)], {
    tags: [repoTag(repo)],
  })();
}

/**
 * 「最後に急ぎの知らせが来た時刻」（ミリ秒）。急ぎの知らせのタグが無効になった後に初めて読んだ時刻。
 * 持ち分を使った記録に覚えた物と違えば、その後に急ぎの知らせが来ている。まだ許していない変化があるときだけ読む
 */
function readUrgentAt(repo: WatchedRepo): Promise<number> {
  return unstable_cache(async () => Date.now(), ["repo-urgent-at-ms", repoChangeKey(repo)], {
    tags: [urgentTag(repo)],
  })();
}

/**
 * 手で押す「同期」・ボタン操作の印：そのとき（無効にした後に初めて読んだとき）の「最後に変わった時刻」と、その時刻。ミリ秒。
 * これ以前の変化は、取り直しの持ち分に関係なく取り直してよい。
 * 書き直すことは無い（タグを無効にしたリクエストの中で書いた物は、無効にした時刻より古い物として捨てられるため、
 * 取り直しの持ち分はここに覚えず、キーで分けた記録に覚える。下の `refetchRecord`）
 */
type Release = { changedAt: number; releasedAt: number };

/**
 * 手で押す「同期」・ボタン操作の印。初めて読むとき（無効にした後も）は、渡した「最後に変わった時刻」と今の時刻になる。
 * `unstable_cache` の中で別の `unstable_cache` を呼ぶと中はキャッシュされないので、「最後に変わった時刻」は先に読んで渡す
 */
function readRelease(repo: WatchedRepo, changedAt: number): Promise<Release> {
  return unstable_cache(
    async (): Promise<Release> => ({ changedAt, releasedAt: Date.now() }),
    ["repo-release-ms", repoChangeKey(repo)],
    { tags: [releaseTag(repo)] },
  )();
}

/** 記録がまだ無いことを、キャッシュに覚えさせずに知らせる印 */
const NO_RECORD = "refetch-record-missing";

/**
 * キーで分けた、書き直さない記録。`fill` を渡すと、まだ無ければその中身で作る。もうあれば、ある物を返す。
 * `fill` が null なら見るだけで、無ければ null（投げた結果はキャッシュに残らない）。
 * タグは付けない（タグを無効にしたリクエストの中で書いた物は、無効にした時刻より古い物として捨てられるため、
 * 取り直しの持ち分は、タグで無効にする入れ物ではなく、この記録に覚える）。どのインスタンスでも同じ物が読める
 */
async function keyedRecord<T>(keyParts: string[], fill: T | null): Promise<T | null> {
  try {
    return await unstable_cache(async (): Promise<T> => {
      if (fill === null) throw new Error(NO_RECORD);
      return fill;
    }, keyParts)();
  } catch (error) {
    if (error instanceof Error && error.message === NO_RECORD) return null;
    throw error;
  }
}

/** 取り直しの持ち分を使った記録（区切りの番号ごと。1回分は1回しか使えない。`src/lib/refetchLimit.ts`） */
function refetchRecord(repo: WatchedRepo, period: number, fill: RefetchRecord | null): Promise<RefetchRecord | null> {
  return keyedRecord(["repo-refetch-record-v1", repoChangeKey(repo), String(period)], fill);
}

/** その「最後に変わった時刻」の取り直しを、もう許したか（許したときに作る。区切りが進んでも分かるように、時刻ごとに覚える） */
function releasedRecord(repo: WatchedRepo, changedAt: number, fill: { at: number } | null): Promise<{ at: number } | null> {
  return keyedRecord(["repo-released-v1", repoChangeKey(repo), String(changedAt)], fill);
}

/**
 * 取り直してよい「最後に変わった時刻」（ミリ秒）。データのキーと、画面に見せる「変わった」印に使う。GitHub には問い合わせない。
 * - しばらく変わっていない（`isSettledChange`）：「最後に変わった時刻」そのまま（読むのは1つだけ）
 * - もう取り直しを許した変化・手で押す「同期」やボタン操作より後に変わっていない：そのまま
 * - まだ許していない変化：持ち分が足りれば使って進める（`decideRefetch`）。足りなければ、前に許した所のまま
 *   （待つ間に何回変わっても、進めた後の1回にまとまる）
 * 持ち分の記録はキャッシュに置くので、どのインスタンスでも同じに効く。タグは無効にしないので、ページの表示からも呼べる
 */
async function releasedChangedAt(repo: WatchedRepo, now: number): Promise<number> {
  const changedAt = await readChangedAt(repo);
  if (isSettledChange(changedAt, now)) return changedAt;
  if (await releasedRecord(repo, changedAt, null)) return changedAt;
  const period = refetchPeriod(now);
  const [release, current, previous] = await Promise.all([
    readRelease(repo, changedAt),
    refetchRecord(repo, period, null),
    refetchRecord(repo, period - 1, null),
  ]);
  // 手で押す「同期」・ボタン操作の時点までの変化は、持ち分に関係なく取り直す
  if (release.changedAt >= changedAt) return changedAt;
  const urgentAt = await readUrgentAt(repo);
  const decision = decideRefetch({ now, changedAt, urgentAt, current, previous });
  if (decision.spend) {
    const spent = await refetchRecord(repo, decision.spend === "current" ? period : period - 1, {
      changedAt,
      urgentAt,
      at: now,
    });
    // 同時に別の所が同じ持ち分を使っていたら、そちらの記録が返る（その印に合わせ、この変化は次に回す）
    if (spent && spent.changedAt >= changedAt) {
      await releasedRecord(repo, changedAt, { at: now });
      return changedAt;
    }
    return Math.max(spent?.changedAt ?? 0, decision.released ?? 0, release.changedAt);
  }
  return Math.max(decision.released ?? 0, release.changedAt);
}

/**
 * Next.js のキャッシュに覚える前に、データを縮める（gzip して base64 の文字列にする）。
 * Next.js は、JSON にして 2MB を超える物を覚えない（黙って捨てる。`next/dist/server/lib/incremental-cache`）。
 * Issue・PR の多いリポジトリ（14日で数百件。コメント・チェックつき）はこれを超え、毎回 GitHub から取り直していた
 * （ページ送りが何回も順に並ぶので、そのリポジトリだけで十数秒）。縮めると数分の1になる
 */
export function packCached<T>(value: T): string {
  return gzipSync(JSON.stringify(value)).toString("base64");
}

/** `packCached` で縮めた物を戻す */
export function unpackCached<T>(packed: string): T {
  return JSON.parse(gunzipSync(Buffer.from(packed, "base64")).toString("utf8")) as T;
}

/** 同じインスタンスで、同じ印のデータを同時に取りに行っている物（リクエストをまたいで1回にまとめる） */
const loadingRepoData = new Map<string, Promise<RepoData>>();

/** App の鍵で読んだデータと、そのデータに反映済みの「変わった」印（ISO 文字列） */
export type AppRepoData = { data: RepoData; changeMark: string };

/**
 * App の鍵で読むリポジトリのデータを、最大5分覚える（縮めて覚える。2MB を超えると Next.js が覚えないため）。
 * キーはリポジトリと取り直してよい印の「最後に変わった時刻」（鍵は1時間で替わるので入れない。App の鍵で読むのは、
 * ログインした人が読めると確かめた物だけ）。変化ごとに別の入れ物になるので、取得の途中に Webhook が来ても、
 * 保存した瞬間にその無効化が消えることは無い（次の印で取り直される）。
 * どの印のデータを返すか（取り直してよいか）は `releasedChangedAt` が決める
 */
export async function cachedRepoData(
  repo: WatchedRepo,
  load: () => Promise<RepoData>,
): Promise<AppRepoData> {
  const mark = await releasedChangedAt(repo, Date.now());
  // 縮めて覚える（`packCached`。キーの名前は、縮める前に覚えた物を読まないように変えてある）
  const keyParts = ["repo-data-gz", DEPLOY_KEY, repoChangeKey(repo), String(mark)];
  // 同時に来た別のリクエスト（取り直しの途中のページ移動・別のタブ）が同じ印を読むときは、取得を1回にまとめる
  const data = await shareInFlight(loadingRepoData, keyParts.join("|"), async () =>
    unpackCached<RepoData>(
      await unstable_cache(async () => packCached(await load()), keyParts, { revalidate: REPO_CACHE_SECONDS })(),
    ),
  );
  return { data, changeMark: new Date(mark).toISOString() };
}

/** 覚えている最後の結果を、書き直してよくなるまでの秒数（読むたびに、その時の新しい結果で書き直す） */
export const SNAPSHOT_REWRITE_SECONDS = 1;

/**
 * 覚えている最後の結果（古くてよい。docs/spec.md の「全部のリポジトリを待つページ」）。新しい結果（`fresh`）が遅いときに、先に画面に出す。
 * キーはリポジトリだけ（印を入れない）なので、印が進んで新しいデータを GitHub から取り直している間も、前のデータが読める。
 * どのインスタンスでも同じ物が読める。覚えている物があれば、`fresh` を待たずにすぐ返し、裏で `fresh` の結果に書き直す
 * （`unstable_cache` は、寿命を過ぎた物をすぐ返して裏で作り直す。作り直しは `fresh` を待つだけなので、GitHub の呼び出しは増えない。
 * タグは付けない：タグを無効にしたリクエストの中で書いた物は捨てられるため）。
 * 覚えている物が無いときは `fresh` を待って返す。`fresh` が失敗したら、覚えている物はそのまま残る（無ければ null）
 */
export async function snapshotRepoData(repo: WatchedRepo, fresh: Promise<AppRepoData>): Promise<AppRepoData | null> {
  const keyParts = ["repo-snapshot-gz", DEPLOY_KEY, repoChangeKey(repo)];
  // 同じ入れ物を、中身を作る関数だけ替えて読む（`unstable_cache` は関数の文字列もキーに使うので、この1か所を通す）
  const entry = (produce: () => Promise<string>): Promise<string> =>
    unstable_cache(async () => produce(), keyParts, { revalidate: SNAPSHOT_REWRITE_SECONDS })();
  // 覚えている物を見るだけ（無ければ投げる。投げた結果は覚えられない）
  const previous = await entry(async () => {
    throw new Error(NO_RECORD);
  }).then(
    (packed) => unpackCached<AppRepoData>(packed),
    () => null,
  );
  try {
    // 縮めて覚える（2MB を超えると Next.js が覚えないため。`packCached`）。
    // 中身が空になった読みは、覚えている物を上書きしない（`shouldRememberSnapshot`）。投げれば前の物が残る
    const packed = await entry(async () => {
      const next = await fresh;
      if (!shouldRememberSnapshot(previous?.data ?? null, next.data)) throw new Error("not worth remembering");
      return packCached(next);
    });
    return unpackCached<AppRepoData>(packed);
  } catch {
    return null;
  }
}

/** 「ログインした人が読めると確かめた」結果を覚える長さ（秒。`appToken.ts` のメモリの記憶と同じ10分） */
export const READ_CHECK_SECONDS = 10 * 60;

/**
 * ログインした人がそのリポジトリを読めると確かめた結果を、どのインスタンスでも読めるように覚える（10分）。
 * 覚えた古い結果（`snapshotRepoData`）を、立ち上がった直後のインスタンスでも GitHub を待たずに見せるため。
 * キーはトークンのハッシュとリポジトリ（トークンそのものは入れない）。10分より古い物は使わず、確かめ直す
 * （`unstable_cache` は寿命を過ぎた物も一度は返すので、確かめた時刻を一緒に覚えて自分で比べる）。
 * 読めると確かめられなかったときは false
 */
export async function cachedUserCanRead(
  userToken: string,
  repo: WatchedRepo,
  check: () => Promise<boolean>,
  nowMs: number = Date.now(),
): Promise<boolean> {
  const tokenHash = createHash("sha256").update(userToken).digest("hex");
  try {
    const known = await unstable_cache(
      async (): Promise<{ ok: boolean; at: number }> => ({ ok: await check(), at: Date.now() }),
      ["repo-read-check", tokenHash, repoChangeKey(repo)],
      { revalidate: READ_CHECK_SECONDS },
    )();
    if (nowMs - known.at < READ_CHECK_SECONDS * 1000) return known.ok;
    return await check();
  } catch {
    return false;
  }
}

/** 手で押す「同期」・ボタン操作の後：取り直しの持ち分に関係なく、次の表示ですぐ取り直す */
export function invalidateRepoNow(repo: WatchedRepo): void {
  updateTag(repoTag(repo));
  updateTag(releaseTag(repo));
}

/**
 * 画面に見せる「変わった」印：取り直してよい「最後に変わった時刻」（`releasedChangedAt`）。GitHub には問い合わせない。
 * 画面は、これが反映済みの印より新しいときだけ取り直す
 */
export async function getChangeMark(repo: WatchedRepo, now: number = Date.now()): Promise<string> {
  return new Date(await releasedChangedAt(repo, now)).toISOString();
}

/** 監視リポジトリごとの印（`/api/changes` から呼ぶ） */
export async function getChangeMarks(repos: WatchedRepo[]): Promise<ChangeMarks> {
  const entries = await Promise.all(
    repos.map(async (repo) => [repoChangeKey(repo), await getChangeMark(repo)] as const),
  );
  return Object.fromEntries(entries);
}

/**
 * 画面が使う「設定の監視リポジトリ」（`AGENT_DESK_WATCHED_REPOS` の値。無ければ null）を、Next.js のキャッシュに覚える
 * （docs/spec.md の「監視するリポジトリ」）。layout・ページ・操作のたびに GitHub を読みに行かないため
 * （読むのを待つ間は、画面に何も返せない）。キーは保存先とログインした人（その人のトークンで読めた値だけを、その人に使う）。
 * `read` が投げたとき（権限なし・通信失敗）は覚えない。寿命を過ぎた物の読み直しが失敗したら、覚えた値のまま
 */
export async function cachedWatchedVariable(
  settingsRepo: WatchedRepo,
  login: string,
  read: () => Promise<string | null>,
): Promise<string | null> {
  const known = await unstable_cache(
    async (): Promise<{ value: string | null }> => ({ value: await read() }),
    ["watched-repos-variable", repoChangeKey(settingsRepo), login.toLowerCase()],
    { tags: [WATCHED_REPOS_TAG], revalidate: WATCHED_VARIABLE_CACHE_SECONDS },
  )();
  return known.value;
}

/**
 * 表示の途中（同期の中）で監視リポジトリを書き換えた（自動で足した）あと：覚えた一覧を、返事を返し終えてから捨てる。
 * 描画の途中ではタグを無効にできないので、`after` の中で行う。次の表示は GitHub から読み直す
 */
export function forgetWatchedReposAfterResponse(): void {
  after(() => {
    revalidateTag(WATCHED_REPOS_TAG, { expire: 0 });
  });
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
