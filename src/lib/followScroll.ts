/**
 * 中央の並びは上が古く下が新しい。いちばん下にいる間だけ新しい物に追従し、
 * 上にさかのぼって読んでいる間は位置を動かさない（docs/spec.md の「開いたときの位置と、追従」）
 */

/** いちばん下から、これ以内（px）ならいちばん下にいるとみなす */
export const FOLLOW_THRESHOLD = 80;

/** 開いたとき・切り替えたときに始める位置 */
export type OpenPosition = "top" | "answer" | "bottom";

/**
 * 開いたとき・切り替えたときの位置。
 * 中身が画面に収まるなら上から（下に余白を残す）、答える欄のある1件があればその1件の上端、
 * それ以外で中身が多いときだけ最新（いちばん下）。
 */
export function openPosition(scrollHeight: number, clientHeight: number, hasAnswer: boolean): OpenPosition {
  if (scrollHeight <= clientHeight) return "top";
  return hasAnswer ? "answer" : "bottom";
}

/** 追従するか：いちばん下の近くにいて、答える欄を読んでいる・書いている途中ではないとき */
export function shouldFollow(nearBottom: boolean, answering: boolean): boolean {
  return nearBottom && !answering;
}

/** いちばん下までの残りの距離（px）。0 未満にはしない */
export function distanceFromBottom(scrollHeight: number, scrollTop: number, clientHeight: number): number {
  return Math.max(0, scrollHeight - scrollTop - clientHeight);
}

/** いちばん下にいるか（追従するか）。しきい値ちょうどは「いる」 */
export function isNearBottom(
  scrollHeight: number,
  scrollTop: number,
  clientHeight: number,
  threshold: number = FOLLOW_THRESHOLD,
): boolean {
  return distanceFromBottom(scrollHeight, scrollTop, clientHeight) <= threshold;
}
