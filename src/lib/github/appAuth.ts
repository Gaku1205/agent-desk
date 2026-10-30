import { createPrivateKey, sign, type KeyObject } from "node:crypto";
import type { Env } from "../config";

/** 鍵を使い回す、期限までの余裕（これより近づいたら取り直す） */
export const INSTALLATION_TOKEN_MARGIN_MS = 5 * 60 * 1000;

export type AppCredentials = { appId: string; privateKey: KeyObject };

/** 環境変数の秘密鍵を PEM にする。前後の空白と引用符を外し、`\n` の文字を改行に戻す */
export function normalizePrivateKey(raw: string): string {
  let value = raw.trim();
  if (value.length >= 2 && /^(["'])[\s\S]*\1$/.test(value)) value = value.slice(1, -1);
  return value.replace(/\\n/g, "\n").trim();
}

/**
 * 環境変数 `PIPELINE_APP_ID` と `PIPELINE_APP_PRIVATE_KEY` を読む。
 * どちらかが空、または秘密鍵が PEM として読めないときは null（「環境変数が無い」と同じ）。
 * 失敗の理由に鍵の中身は含めない
 */
export function readAppCredentials(env: Env = process.env): AppCredentials | null {
  const appId = env.PIPELINE_APP_ID?.trim();
  const rawKey = env.PIPELINE_APP_PRIVATE_KEY;
  if (!appId || !rawKey || rawKey.trim() === "") return null;
  try {
    const privateKey = createPrivateKey(normalizePrivateKey(rawKey));
    return privateKey.asymmetricKeyType === "rsa" ? { appId, privateKey } : null;
  } catch {
    return null;
  }
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

/** App の JWT（RS256）。`iat` は60秒前（時計のずれ対策）、`exp` は9分後（10分以内） */
export function buildAppJwt(appId: string, privateKey: KeyObject, nowMs: number): string {
  const nowSec = Math.floor(nowMs / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({ iat: nowSec - 60, exp: nowSec + 9 * 60, iss: appId }),
  );
  const signingInput = `${header}.${payload}`;
  const signature = sign("RSA-SHA256", Buffer.from(signingInput), privateKey);
  return `${signingInput}.${base64url(signature)}`;
}

/** 覚えている鍵を使い回すか（期限の5分前までは使い回す。期限が読めなければ取り直す） */
export function shouldReuseInstallationToken(expiresAtMs: number, nowMs: number): boolean {
  return Number.isFinite(expiresAtMs) && expiresAtMs - nowMs > INSTALLATION_TOKEN_MARGIN_MS;
}

export type ReadSource = "app" | "user";

/** 同期の読み取りに、どちらの鍵を使うか。3つとも揃っているときだけ App の鍵 */
export function chooseReadSource(input: {
  hasCredentials: boolean;
  hasInstallationToken: boolean;
  userCanRead: boolean;
}): ReadSource {
  return input.hasCredentials && input.hasInstallationToken && input.userCanRead ? "app" : "user";
}
