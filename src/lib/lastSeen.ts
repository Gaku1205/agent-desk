// 「ホームを最後に開いていた時刻」を、このブラウザに覚える（docs/spec.md の「いない間のまとめ」）。
// `lastShown.ts` と同じ作り：読めなければ null。ブラウザでも使うので、サーバーだけの物は import しない

export const LAST_SEEN_KEY = "agent-desk:last-seen";

/** 覚えた時刻（ISO文字列）。読めなければ null */
export function readLastSeen(): string | null {
  try {
    return window.localStorage.getItem(LAST_SEEN_KEY);
  } catch {
    return null;
  }
}

export function writeLastSeen(at: Date): void {
  try {
    window.localStorage.setItem(LAST_SEEN_KEY, at.toISOString());
  } catch {
    // 覚えられなくても、表示は変わらない
  }
}
