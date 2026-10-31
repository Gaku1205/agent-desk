import { createHash } from "node:crypto";
import type { Env, WatchedRepo } from "../config";
import {
  buildAppJwt,
  chooseReadSource,
  readAppCredentials,
  shouldReuseInstallationToken,
  type AppCredentials,
} from "./appAuth";
import { GitHubClient, type Fetcher } from "./client";
import { GitHubError } from "./errors";
import { getRateLimits, type RateLimitInfo } from "./rateLimit";

// このファイルはサーバーだけで使う（App の秘密鍵・インストールの鍵を扱う）。
// クライアントのコンポーネントから import しない。鍵はログ・エラー文に出さない。

const API_BASE = "https://api.github.com";
/** インストールの調べ結果・「読めると確かめた」結果を覚える時間 */
export const LOOKUP_TTL_MS = 10 * 60 * 1000;
/** 覚える件数の上限（超えたら古い物から捨てる） */
export const APP_CACHE_MAX_ENTRIES = 500;

/** 同期の読み取りに使う、App のインストールの鍵 */
export type ReadAccess = {
  token: string;
  /** ETag・回数制限の記憶のキー。鍵は1時間で替わるので、インストールごとの固定の名前にする */
  keyId: string;
};

type Remembered<T> = { value: T; at: number };

/** `owner/repo` → インストールの ID（入っていなければ null） */
const installations = new Map<string, Remembered<number | null>>();
/** インストールの ID → 鍵と期限 */
const installationTokens = new Map<number, { token: string; expiresAtMs: number }>();
/** トークンのハッシュ＋リポジトリ → ログインした人のトークンで読めるか */
const readChecks = new Map<string, Remembered<boolean>>();
/** 鍵を使ったインストール（回数制限の残りを見るため） */
const usedInstallationIds = new Set<number>();

function remember<K, V>(map: Map<K, V>, key: K, value: V): void {
  map.delete(key);
  map.set(key, value);
  while (map.size > APP_CACHE_MAX_ENTRIES) {
    const oldest = map.keys().next();
    if (oldest.done) break;
    map.delete(oldest.value);
  }
}

function fresh<T>(entry: Remembered<T> | undefined, nowMs: number): entry is Remembered<T> {
  return entry !== undefined && nowMs - entry.at < LOOKUP_TTL_MS;
}

function repoKey({ owner, repo }: WatchedRepo): string {
  return `${owner}/${repo}`.toLowerCase();
}

/** ETag・回数制限の記憶のキー（App の鍵のとき） */
export function installationKeyId(installationId: number): string {
  return `app-installation:${installationId}`;
}

/** テスト用：覚えている物を空にする */
export const appTokenCacheForTest = {
  clear: (): void => {
    installations.clear();
    installationTokens.clear();
    readChecks.clear();
    usedInstallationIds.clear();
  },
  sizes: () => ({
    installations: installations.size,
    tokens: installationTokens.size,
    readChecks: readChecks.size,
  }),
};

/** インストールの鍵は読み取りだけの権限で作る（書き込みは App の鍵で使わない） */
export const READ_ONLY_PERMISSIONS = {
  contents: "read",
  issues: "read",
  pull_requests: "read",
  checks: "read",
  statuses: "read",
  actions: "read",
  metadata: "read",
} as const;

async function appRequest(
  fetcher: Fetcher,
  jwt: string,
  method: "GET" | "POST",
  path: string,
  jsonBody?: unknown,
): Promise<unknown | null> {
  try {
    const response = await fetcher(`${API_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(jsonBody === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(jsonBody === undefined ? {} : { body: JSON.stringify(jsonBody) }),
      cache: "no-store",
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    // 原因にはヘッダー（JWT）が入りうるので捨てる
    return null;
  }
}

/** `GET /repos/{owner}/{repo}/installation`。入っていない・調べられないときは null（10分覚える） */
async function findInstallationId(
  credentials: AppCredentials,
  repo: WatchedRepo,
  fetcher: Fetcher,
  nowMs: number,
): Promise<number | null> {
  const key = repoKey(repo);
  const known = installations.get(key);
  if (fresh(known, nowMs)) return known.value;
  const jwt = buildAppJwt(credentials.appId, credentials.privateKey, nowMs);
  const body = (await appRequest(
    fetcher,
    jwt,
    "GET",
    `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/installation`,
  )) as { id?: unknown } | null;
  const id = typeof body?.id === "number" ? body.id : null;
  remember(installations, key, { value: id, at: nowMs });
  return id;
}

/** `POST /app/installations/{id}/access_tokens`。期限の5分前までは覚えている鍵を使い回す */
async function getInstallationToken(
  credentials: AppCredentials,
  installationId: number,
  fetcher: Fetcher,
  nowMs: number,
): Promise<string | null> {
  const known = installationTokens.get(installationId);
  if (known && shouldReuseInstallationToken(known.expiresAtMs, nowMs)) return known.token;
  const jwt = buildAppJwt(credentials.appId, credentials.privateKey, nowMs);
  const body = (await appRequest(
    fetcher,
    jwt,
    "POST",
    `/app/installations/${installationId}/access_tokens`,
    { permissions: READ_ONLY_PERMISSIONS },
  )) as { token?: unknown; expires_at?: unknown } | null;
  if (typeof body?.token !== "string" || body.token === "") return null;
  const expiresAtMs = typeof body.expires_at === "string" ? Date.parse(body.expires_at) : NaN;
  if (!Number.isFinite(expiresAtMs)) return null;
  installationTokens.set(installationId, { token: body.token, expiresAtMs });
  usedInstallationIds.add(installationId);
  return body.token;
}

/**
 * ログインした人のトークンで、そのリポジトリを読めるか（`GET /repos/{owner}/{repo}`）。
 * 成功と、404・403（権限なし）は10分覚える。通信失敗・レート制限などは覚えず false
 */
async function userCanRead(
  userToken: string,
  repo: WatchedRepo,
  fetcher: Fetcher,
  nowMs: number,
): Promise<boolean> {
  const key = `${createHash("sha256").update(userToken).digest("hex")}:${repoKey(repo)}`;
  const known = readChecks.get(key);
  if (fresh(known, nowMs)) return known.value;
  try {
    await new GitHubClient(userToken, fetcher).get(
      `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}`,
    );
    remember(readChecks, key, { value: true, at: nowMs });
    return true;
  } catch (error) {
    if (error instanceof GitHubError && (error.kind === "not_found" || error.kind === "forbidden")) {
      remember(readChecks, key, { value: false, at: nowMs });
    }
    return false;
  }
}

/**
 * そのリポジトリのインストールの記憶（`owner/repo` → インストール ID）と、そのインストールの覚えた鍵を消す。
 * App の鍵で「権限なし・見つからない」になったとき（アプリを外した直後など）に呼ぶ。
 * ログインした人の読める確認（readChecks）は消さない
 */
export function forgetInstallation(repo: WatchedRepo): void {
  const key = repoKey(repo);
  const id = installations.get(key)?.value;
  installations.delete(key);
  if (typeof id === "number") {
    installationTokens.delete(id);
    usedInstallationIds.delete(id);
  }
}

/**
 * ログインした人がいない所（Webhook の受け取り）で、そのリポジトリの App のインストールの鍵だけを取る。
 * 設定の監視リポジトリ（Variable）を読むのに使う。環境変数が無い・App が入っていない・鍵が取れないときは null
 */
export async function resolveAppAccess(
  repo: WatchedRepo,
  options: { env?: Env; fetcher?: Fetcher; nowMs?: number } = {},
): Promise<ReadAccess | null> {
  const fetcher = options.fetcher ?? fetch;
  const nowMs = options.nowMs ?? Date.now();
  const credentials = readAppCredentials(options.env);
  if (!credentials) return null;
  const installationId = await findInstallationId(credentials, repo, fetcher, nowMs);
  if (installationId === null) return null;
  const token = await getInstallationToken(credentials, installationId, fetcher, nowMs);
  if (token === null) return null;
  return { token, keyId: installationKeyId(installationId) };
}

/**
 * 同期の読み取りに使う App のインストールの鍵。使えないときは null（ログインした人のトークンで読む）。
 * 環境変数が無い・App が入っていない・鍵が取れない・ログインした人が読めると確かめられない、のどれでも null
 */
export async function resolveReadAccess(
  userToken: string,
  repo: WatchedRepo,
  options: { env?: Env; fetcher?: Fetcher; nowMs?: number } = {},
): Promise<ReadAccess | null> {
  const fetcher = options.fetcher ?? fetch;
  const nowMs = options.nowMs ?? Date.now();
  const credentials = readAppCredentials(options.env);
  if (!credentials) return null;
  const installationId = await findInstallationId(credentials, repo, fetcher, nowMs);
  if (installationId === null) return null;
  const token = await getInstallationToken(credentials, installationId, fetcher, nowMs);
  if (token === null) return null;
  const source = chooseReadSource({
    hasCredentials: true,
    hasInstallationToken: true,
    userCanRead: await userCanRead(userToken, repo, fetcher, nowMs),
  });
  return source === "app" ? { token, keyId: installationKeyId(installationId) } : null;
}

/**
 * 回数制限の残りが最も少ない物（鍵ごとの残りのうち、不明でない物から）。自動の取り直しの間隔を決めるのに使う。
 * 回復する時刻を過ぎた記録は古いので比べない
 */
export function lowestRateLimit(
  infos: RateLimitInfo[],
  nowMs: number = Date.now(),
): RateLimitInfo {
  let lowest: RateLimitInfo = { remaining: null, resetAt: null };
  for (const info of infos) {
    if (info.remaining === null) continue;
    if (info.resetAt !== null && nowMs >= info.resetAt * 1000) continue;
    if (lowest.remaining === null || info.remaining < lowest.remaining) lowest = info;
  }
  return lowest;
}

/** ログインした人のトークンと、使った App の鍵の、REST と GraphQL の残りのうち、いちばん少ない物 */
export function getReadRateLimit(userToken: string): RateLimitInfo {
  return lowestRateLimit([
    ...getRateLimits(userToken),
    ...[...usedInstallationIds].flatMap((id) => getRateLimits(installationKeyId(id))),
  ]);
}
