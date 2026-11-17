import type { RepoResult } from "./github/types";

/** 認証切れで戻すログイン画面の場所（理由はクエリで伝える。トークンなどは含めない） */
export const EXPIRED_LOGIN_PATH = "/?reason=expired";

/** 認証切れを知らせるクエリ `reason` の値 */
export const EXPIRED_REASON = "expired";

/** ログイン画面に出す、認証切れの理由の1行 */
export const EXPIRED_MESSAGE = "GitHubの認証が切れたので、ログアウトしました。もう一度ログインしてください";

/** 認証切れを受けて、ログアウトしてログインの画面へ戻す Route Handler */
export const SESSION_EXPIRED_PATH = "/api/session-expired";

/**
 * ログインした人のトークンが使えなくなった（401）かどうか。
 * 1つでも 401 ならトークンは全部使えない。404・403・回数の上限・その他、
 * パイプラインのApp側の鍵（readSource が app）の 401 では、ログアウトしない
 */
export function isAuthExpired(results: readonly RepoResult[]): boolean {
  return results.some((r) => !r.ok && r.error.kind === "unauthorized" && r.readSource !== "app");
}
