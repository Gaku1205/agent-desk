/**
 * 札の並び（横スクロール）で、今いる札が見える位置にするための scrollLeft を返す。
 * 札が両端から `edge` 以上内側に入っていれば今の位置のまま。はみ出すときだけ最小限に動かす。
 * 0 未満や、スクロールできる範囲（`scrollWidth - viewportWidth`）の外には行かない
 */
export function revealScrollLeft(input: {
  scrollLeft: number;
  viewportWidth: number;
  scrollWidth: number;
  itemLeft: number;
  itemWidth: number;
  edge: number;
}): number {
  const { scrollLeft, viewportWidth, scrollWidth, itemLeft, itemWidth, edge } = input;
  const max = Math.max(0, scrollWidth - viewportWidth);
  let next = scrollLeft;
  if (itemLeft - edge < next) next = itemLeft - edge;
  else if (itemLeft + itemWidth + edge > next + viewportWidth) next = itemLeft + itemWidth + edge - viewportWidth;
  return Math.min(max, Math.max(0, next));
}
