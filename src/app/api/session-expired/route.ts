import { signOut } from "@/lib/auth";
import { EXPIRED_LOGIN_PATH } from "@/lib/authExpired";

/** GitHubの認証が切れたとき、セッションを終わらせて、理由つきでログインの画面へ戻す */
export async function GET(): Promise<void> {
  await signOut({ redirectTo: EXPIRED_LOGIN_PATH });
}
