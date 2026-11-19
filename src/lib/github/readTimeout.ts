// GitHub の読み取り（GraphQL・REST）の時間切れ（docs/spec.md の「データの取得」）。書き込み（`send`）には付けない

/** GitHub が返事をしないとき、あきらめるまでの長さ（普段は数秒で返るので、遅い回を誤って切らない長さ） */
export const GITHUB_READ_TIMEOUT_MS = 15_000;

/** 読み取り1回ぶんの時間切れの合図 */
export function readTimeoutSignal(ms: number = GITHUB_READ_TIMEOUT_MS): AbortSignal {
  return AbortSignal.timeout(ms);
}

/** 呼び出しが失敗した後、その原因が時間切れか（合図が鳴っていれば時間切れ） */
export function isReadTimedOut(signal: Pick<AbortSignal, "aborted">): boolean {
  return signal.aborted;
}
