/**
 * 中央の並びは上が古く下が新しい。いちばん下にいる間だけ新しい物に追従し、
 * 上にさかのぼって読んでいる間は位置を動かさない（docs/spec.md の「開いたときの位置と、追従」）
 */

/** いちばん下から、これ以内（px）ならいちばん下にいるとみなす */
export const FOLLOW_THRESHOLD = 80;

/** 開いたとき・切り替えたときに始める位置。current は真ん中の1件（一覧なら見出し）の上端 */
export type OpenPosition = "top" | "answer" | "current" | "bottom";

/**
 * 開いたとき・切り替えたときの位置。
 * 中身が画面に収まるなら上から（下に余白を残す）、答える欄のある1件があればその1件の上端、
 * 真ん中の1件が右の列より上に回っている（stacked：幅1179px以下のリポジトリのページ。Issue #786）なら
 * その1件の上端（答える欄が無くても）、それ以外で中身が多いときだけ最新（いちばん下）。
 */
export function openPosition(
  scrollHeight: number,
  clientHeight: number,
  hasAnswer: boolean,
  stacked: boolean = false,
): OpenPosition {
  if (scrollHeight <= clientHeight) return "top";
  if (hasAnswer) return "answer";
  return stacked ? "current" : "bottom";
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
