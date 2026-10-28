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

/** 返事のヘッダーに残りがあれば、そのトークンの分として覚える（無ければ前の物のまま） */
export function rememberRateLimit(token: string, headers: Headers): void {
  const info = parseRateLimit(headers);
  if (info.remaining === null) return;
  rateLimits.set(tokenKey(token), info);
}

/** 覚えている残りと回復する時刻。まだ返事を受けていなければ不明 */
export function getRateLimit(token: string): RateLimitInfo {
  return rateLimits.get(tokenKey(token)) ?? { remaining: null, resetAt: null };
}

/** テスト用 */
export const rateLimitForTest = {
  keys: (): string[] => [...rateLimits.keys()],
  clear: (): void => rateLimits.clear(),
};
