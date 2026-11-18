import { createHash } from "node:crypto";

export type RateLimitInfo = {
  /** 残りの回数。不明なら null */
  remaining: number | null;
  /** 回復する時刻（UNIX秒）。不明なら null */
  resetAt: number | null;
};

/** どの鍵の・どの枠の残りか（user＝ログインした人のトークン、app＝パイプラインの App のインストールの鍵） */
export type RateLimitSource = { key: "user" | "app"; resource: "rest" | "graphql" };

/** 残りと、それがどの鍵・どの枠の物か（不明なら source は null） */
export type SourcedRateLimit = RateLimitInfo & { source: RateLimitSource | null };

/**
 * REST の枠（`core`）の返事か。GitHub は返事に `X-RateLimit-Resource` を付ける。別の枠（`search` など）の残りを、
 * REST の残りとして覚えない（数十しか無い枠の残りで、自動更新を止めてしまわないように）。付いていなければ REST として扱う
 */
export function isCoreRateLimit(headers: Headers): boolean {
  const resource = headers.get("x-ratelimit-resource");
  return resource === null || resource.trim() === "" || resource.trim().toLowerCase() === "core";
}

/** サーバーのメモリ。キーはトークンのハッシュ（トークンそのものは入れない） */
const rateLimits = new Map<string, RateLimitInfo>();

function tokenKey(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function parseCount(value: string | null): number | null {
  if (value === null || value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** 返事の `X-RateLimit-Remaining` と `X-RateLimit-Reset`（UNIX秒）を読む */
export function parseRateLimit(headers: Headers): RateLimitInfo {
  return {
    remaining: parseCount(headers.get("x-ratelimit-remaining")),
    resetAt: parseCount(headers.get("x-ratelimit-reset")),
  };
}

/** GraphQL の返事の `data.rateLimit`（`remaining` と ISO の `resetAt`）を読む。形が違えば不明 */
export function parseGraphqlRateLimit(value: unknown): RateLimitInfo {
  const info = (value ?? {}) as { remaining?: unknown; resetAt?: unknown };
  const remaining =
    typeof info.remaining === "number" && Number.isFinite(info.remaining) && info.remaining >= 0
      ? info.remaining
      : null;
  const resetMs = typeof info.resetAt === "string" ? Date.parse(info.resetAt) : NaN;
  return { remaining, resetAt: Number.isNaN(resetMs) ? null : Math.floor(resetMs / 1000) };
}

/** 履歴を持つ時間（直近24時間に、余裕の1時間） */
export const HISTORY_MS = 25 * 60 * 60 * 1000;
/** 1つのキーが持つ点の上限（超えたら古い物から捨てる） */
export const HISTORY_MAX_POINTS = 2000;

/** 残りを覚えたときの点（`at` は ms、`resetAt` はUNIX秒） */
export type RateHistoryPoint = { at: number; remaining: number; resetAt: number | null };

/** サーバーのメモリ。キーは `rateLimits` と同じ（トークンのハッシュ）。再起動で空に戻る */
const rateHistory = new Map<string, RateHistoryPoint[]>();

function recordHistory(key: string, info: RateLimitInfo, nowMs: number): void {
  if (info.remaining === null) return;
  const points = (rateHistory.get(key) ?? []).filter((point) => nowMs - point.at <= HISTORY_MS);
  points.push({ at: nowMs, remaining: info.remaining, resetAt: info.resetAt });
  if (points.length > HISTORY_MAX_POINTS) points.splice(0, points.length - HISTORY_MAX_POINTS);
  rateHistory.set(key, points);
}

/** 返事のヘッダーに残りがあれば、そのトークンの分として覚える（無ければ前の物のまま） */
export function rememberRateLimit(token: string, headers: Headers, nowMs: number = Date.now()): void {
  const info = parseRateLimit(headers);
  if (info.remaining === null || !isCoreRateLimit(headers)) return;
  rateLimits.set(tokenKey(token), info);
  recordHistory(tokenKey(token), info, nowMs);
}

/** GraphQL の枠（REST とは別）のキー */
function graphqlKey(token: string): string {
  return `graphql:${tokenKey(token)}`;
}

/** GraphQL の残り（問い合わせの `rateLimit`、無ければ返事のヘッダー）を、そのトークンの分として覚える */
export function rememberGraphqlRateLimit(token: string, info: RateLimitInfo, nowMs: number = Date.now()): void {
  if (info.remaining === null) return;
  rateLimits.set(graphqlKey(token), info);
  recordHistory(graphqlKey(token), info, nowMs);
}

/** そのトークンの REST の残りの履歴（古い順。トークンそのものは入っていない） */
export function getRateHistory(token: string): RateHistoryPoint[] {
  return rateHistory.get(tokenKey(token)) ?? [];
}

/** そのトークンの GraphQL の残りの履歴（古い順） */
export function getGraphqlRateHistory(token: string): RateHistoryPoint[] {
  return rateHistory.get(graphqlKey(token)) ?? [];
}

/** 覚えている REST の残りと回復する時刻。まだ返事を受けていなければ不明 */
export function getRateLimit(token: string): RateLimitInfo {
  return rateLimits.get(tokenKey(token)) ?? { remaining: null, resetAt: null };
}

/** 覚えている GraphQL の残りと回復する時刻。まだ返事を受けていなければ不明 */
export function getGraphqlRateLimit(token: string): RateLimitInfo {
  return rateLimits.get(graphqlKey(token)) ?? { remaining: null, resetAt: null };
}

/** そのトークンの REST と GraphQL の残り（少ない方で判断するため、両方を返す） */
export function getRateLimits(token: string): RateLimitInfo[] {
  return [getRateLimit(token), getGraphqlRateLimit(token)];
}

/** テスト用 */
export const rateLimitForTest = {
  keys: (): string[] => [...rateLimits.keys()],
  clear: (): void => {
    rateLimits.clear();
    rateHistory.clear();
  },
  historyKeys: (): string[] => [...rateHistory.keys()],
};
