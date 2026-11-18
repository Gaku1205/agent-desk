import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { parseSetupRepo } from "./setupState";

// App Manifest の `state` を、署名つきの Cookie と照らして確かめる（docs/spec.md の「導入」の「安全の決まり」）。
// サーバーだけで使う。

export const STATE_COOKIE = "agent-desk-setup-state";
/** Cookie を送るパス（受け取り口だけ） */
export const STATE_COOKIE_PATH = "/api/setup";
/** `state` が使える長さ（1時間） */
export const STATE_TTL_MS = 60 * 60 * 1000;

/** 推測できない `state`（32バイトの乱数） */
export function newSetupState(): string {
  return randomBytes(32).toString("base64url");
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Cookie に置く値：`state`・リポジトリ・作った時刻を、署名つきで */
export function signSetupState(input: { state: string; repo: string; nowMs: number; secret: string }): string {
  const payload = Buffer.from(JSON.stringify({ s: input.state, r: input.repo, t: input.nowMs })).toString("base64url");
  return `${payload}.${sign(payload, input.secret)}`;
}

/**
 * 戻ってきた `state` を Cookie と照らす。署名・一致・1時間以内が全部合えば、そのときのリポジトリを返す。
 * どれか違えば null（何もしない）
 */
export function verifySetupState(input: {
  cookie: string | undefined | null;
  state: string | null | undefined;
  nowMs: number;
  secret: string | undefined;
}): string | null {
  const { cookie, state, nowMs, secret } = input;
  if (!cookie || !state || !secret) return null;
  const dot = cookie.indexOf(".");
  if (dot <= 0) return null;
  const payload = cookie.slice(0, dot);
  const signature = cookie.slice(dot + 1);
  if (!safeEqual(signature, sign(payload, secret))) return null;
  let data: { s?: unknown; r?: unknown; t?: unknown };
  try {
    data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as typeof data;
  } catch {
    return null;
  }
  if (typeof data.s !== "string" || typeof data.r !== "string" || typeof data.t !== "number") return null;
  if (!safeEqual(data.s, state)) return null;
  if (nowMs < data.t || nowMs - data.t > STATE_TTL_MS) return null;
  return parseSetupRepo(data.r) ? data.r : null;
}

/** 使った `code` のハッシュ（サーバーのメモリ。`code` そのものは入れない） */
const usedCodes = new Map<string, number>();
const USED_CODES_MAX = 500;

/** `code` を1回だけ使う。初めてなら true、2回目以降は false */
export function claimManifestCode(code: string, nowMs: number): boolean {
  const key = createHash("sha256").update(code).digest("hex");
  if (usedCodes.has(key)) return false;
  usedCodes.set(key, nowMs);
  while (usedCodes.size > USED_CODES_MAX) {
    const oldest = usedCodes.keys().next();
    if (oldest.done) break;
    usedCodes.delete(oldest.value);
  }
  return true;
}

export const usedCodesForTest = { clear: (): void => usedCodes.clear() };

/** `code` の形（GitHub の一時コード。英数字と `_`・`-`） */
export function isManifestCode(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,200}$/.test(value);
}
