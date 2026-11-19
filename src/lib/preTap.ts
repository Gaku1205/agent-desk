/** ハイドレーション前に押された物を流し直してよい時間の上限（押してから。docs/spec.md の「開いた直後のタップ」） */
export const PRE_TAP_WINDOW_MS = 5000;

export type PreTapInput = {
  /** 押した時刻（ms） */
  tappedAt: number;
  /** 今（ms） */
  now: number;
  /** 押された要素に `data-pre-tap` の印があるか */
  marked: boolean;
  /** すでに流し直したか */
  replayed: boolean;
  /** 要素がまだ画面にあるか */
  connected: boolean;
  /** 要素に React が付いたか（`__reactProps$` がある） */
  hydrated: boolean;
};

/**
 * 覚えた押しを、いま流し直してよいか。
 * 印がある・まだ流し直していない・画面にある・時間内・React が動いた、が全部そろったときだけ true。
 * 先行スクリプト（`menuPreTap.ts` の `MENU_PRE_TAP_SCRIPT`）は同じ決まりで動く
 */
export function shouldReplayPreTap(input: PreTapInput): boolean {
  if (!input.marked || input.replayed || !input.connected || !input.hydrated) return false;
  const elapsed = input.now - input.tappedAt;
  return elapsed >= 0 && elapsed <= PRE_TAP_WINDOW_MS;
}

/** もう流し直せない（待っても意味がない）か：印が無い・流し直した・画面から消えた・時間切れ */
export function isPreTapExpired(input: Pick<PreTapInput, "tappedAt" | "now" | "marked" | "replayed" | "connected">): boolean {
  return !input.marked || input.replayed || !input.connected || input.now - input.tappedAt > PRE_TAP_WINDOW_MS;
}
