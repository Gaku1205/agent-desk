/**
 * 中央の並びは上が古く下が新しい。いちばん下にいる間だけ新しい物に追従し、
 * 上にさかのぼって読んでいる間は位置を動かさない（docs/spec.md の「開いたときの位置と、追従」）
 */

/** いちばん下から、これ以内（px）ならいちばん下にいるとみなす */
export const FOLLOW_THRESHOLD = 80;

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
