import { createHash } from "node:crypto";

export type RateLimitInfo = {
  /** 残りの回数。不明なら null */
  remaining: number | null;
  /** 回復する時刻（UNIX秒）。不明なら null */
  resetAt: number | null;
};

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

/** 返事のヘッダーに残りがあれば、そのトークンの分として覚える（無ければ前の物のまま） */
export function rememberRateLimit(token: string, headers: Headers): void {
  const info = parseRateLimit(headers);
  if (info.remaining === null) return;
  rateLimits.set(tokenKey(token), info);
}

/** GraphQL の枠（REST とは別）のキー */
function graphqlKey(token: string): string {
  return `graphql:${tokenKey(token)}`;
}

/** GraphQL の残り（問い合わせの `rateLimit`、無ければ返事のヘッダー）を、そのトークンの分として覚える */
export function rememberGraphqlRateLimit(token: string, info: RateLimitInfo): void {
  if (info.remaining === null) return;
  rateLimits.set(graphqlKey(token), info);
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
  clear: (): void => rateLimits.clear(),
};
