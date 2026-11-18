/** 左のバーの上の段（札の一覧）の、スクロールの状態 */
export type ScrollMetrics = {
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
};

/**
 * 一覧の下に、まだ見えていない札があるか。
 * あれば、上の段と下の段の境目に線を出す（いちばん下までスクロールしたら出さない）。
 * 小数のずれで線が残らないよう、1px 未満の差は無いものとする。
 */
export function hasHiddenBelow({ scrollTop, clientHeight, scrollHeight }: ScrollMetrics): boolean {
  return scrollTop + clientHeight < scrollHeight - 1;
}
