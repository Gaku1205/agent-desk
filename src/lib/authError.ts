/** ログインの拒否・エラーを出す画面の場所（`pages.error` に渡す） */
export const AUTH_ERROR_PATH = "/auth-error";

/** 許可リストに入っていないときの、Auth.js の `error` の値 */
export const ACCESS_DENIED_ERROR = "AccessDenied";

export const ACCESS_DENIED_MESSAGE = "このアカウントでは使えません。agent-desk はオーナー専用です。オーナーのアカウントでログインし直してください";
export const AUTH_ERROR_MESSAGE =
  "ログインできませんでした。通信や設定に問題があるかもしれません。もう一度ログインしてください。直らないときは、しばらくしてから試してください";

/**
 * `error` クエリの値から、画面に出す1行を決める。
 * 値そのもの（内部の詳細）は返さず、2つの文言のどちらかだけを返す
 */
export function getAuthErrorMessage(error: string | string[] | undefined): string {
  const value = Array.isArray(error) ? error[0] : error;
  return value === ACCESS_DENIED_ERROR ? ACCESS_DENIED_MESSAGE : AUTH_ERROR_MESSAGE;
}
