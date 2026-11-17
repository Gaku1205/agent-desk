import { NextResponse } from "next/server";
import { getGitHubToken, signOut } from "@/lib/auth";
import { EXPIRED_LOGIN_PATH, NOT_EXPIRED_PATH, confirmTokenExpired } from "@/lib/authExpired";

/**
 * GitHubの認証が切れたとき、セッションを終わらせて、理由つきでログインの画面へ戻す。
 * 他サイトから開かれて勝手にログアウトさせられないよう、GitHub で 401 になると確かめてからだけ行う
 */
export async function GET(request: Request): Promise<Response | void> {
  const token = await getGitHubToken();
  if (!(await confirmTokenExpired(token))) {
    return NextResponse.redirect(new URL(NOT_EXPIRED_PATH, request.url));
  }
  await signOut({ redirectTo: EXPIRED_LOGIN_PATH });
}
