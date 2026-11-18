import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getGitHubToken, getSignedInLogin } from "@/lib/auth";
import { GitHubClient } from "@/lib/github/client";
import { handleManifestReturn } from "@/lib/github/setup";
import { STATE_COOKIE, STATE_COOKIE_PATH } from "@/lib/setupCookie";

/**
 * App Manifest の戻り先（docs/spec.md の「導入」）。`state` を署名つきの Cookie と照らし、
 * 合えば `code` を1回だけ交換して、秘密鍵を Secret に、App ID を Variable に書いて捨てる
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const store = await cookies();
  const cookie = store.get(STATE_COOKIE)?.value;
  // 確かめたら（合っても違っても）すぐ消す：同じ state では二度と通さない
  store.set(STATE_COOKIE, "", { path: STATE_COOKIE_PATH, maxAge: 0, httpOnly: true, sameSite: "lax" });
  const login = await getSignedInLogin();
  const token = await getGitHubToken();
  const path = await handleManifestReturn({
    cookie,
    state: url.searchParams.get("state"),
    code: url.searchParams.get("code"),
    secret: process.env.AUTH_SECRET,
    nowMs: Date.now(),
    login,
    client: token ? new GitHubClient(token) : null,
  });
  return NextResponse.redirect(new URL(path, request.url));
}
