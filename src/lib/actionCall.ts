/**
 * サーバーの操作（Server Action）の呼び出しそのものが失敗したとき（docs/spec.md の「操作」）。
 * 通信が切れた・公開し直したあとの古い画面のまま押した、などで、サーバーの処理まで届いていない。
 * `startTransition` の中で投げられたままにすると、画面全体がエラーの表示に替わり、書きかけの答えも消える
 */
export const ACTION_UNREACHABLE_MESSAGE =
  "サーバーに届きませんでした。ページを読み込み直して、もう一度試してください";

/**
 * サーバーの操作を呼ぶ。呼び出しが投げたら（届かなかったら）、投げずに `onUnreachable` の結果を返す。
 * サーバーが返した失敗（`{ ok: false, message }` など）は、そのまま返す
 */
export async function callAction<T>(call: () => Promise<T>, onUnreachable: () => T): Promise<T> {
  try {
    return await call();
  } catch {
    return onUnreachable();
  }
}
