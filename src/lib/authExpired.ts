import type { RepoResult } from "./github/types";

/** 認証切れで戻すログイン画面の場所（理由はクエリで伝える。トークンなどは含めない） */
export const EXPIRED_LOGIN_PATH = "/?reason=expired";

/** 認証切れを知らせるクエリ `reason` の値 */
export const EXPIRED_REASON = "expired";

/** ログイン画面に出す、認証切れの理由の1行 */
export const EXPIRED_MESSAGE = "GitHubの認証が切れたので、ログアウトしました。もう一度ログインしてください";

/** 認証切れを受けて、ログアウトしてログインの画面へ戻す Route Handler */
export const SESSION_EXPIRED_PATH = "/api/session-expired";

/** 認証が切れていないと分かったとき・確かめられなかったときに戻す場所（理由なし） */
export const NOT_EXPIRED_PATH = "/";

/**
 * トークンが本当に GitHub で 401 になるか、軽い確認（GET /user）で確かめる。
 * 401 のときだけ true。トークンが無い・成功・通信失敗・403・回数の上限などは false。
 * トークンは GitHub への Authorization ヘッダーにだけ使い、ログ・URL には出さない
 */
export async function confirmTokenExpired(
  token: string | null,
  fetchFn: typeof fetch = fetch,
): Promise<boolean> {
  if (!token) return false;
  try {
    const res = await fetchFn("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      cache: "no-store",
    });
    return res.status === 401;
  } catch {
    return false;
  }
}

/**
 * ログインした人のトークンが使えなくなった（401）かどうか。
 * 1つでも 401 ならトークンは全部使えない。404・403・回数の上限・その他、
 * パイプラインのApp側の鍵（readSource が app）の 401 では、ログアウトしない
 */
export function isAuthExpired(results: readonly RepoResult[]): boolean {
  return results.some((r) => !r.ok && r.error.kind === "unauthorized" && r.readSource !== "app");
}
