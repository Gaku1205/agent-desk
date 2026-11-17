/** 画像を外したあとにフォーカスを渡す先：画像の番号（外したあとの並びでの番号）か、`画像を付ける` ボタン */
export type FocusAfterRemove = { kind: "image"; index: number } | { kind: "attach" };

/**
 * 画像を外したあとのフォーカス先を決める。
 * 次の画像の `×`、外したのが最後なら1つ前の画像の `×`、1枚も残らなければ `画像を付ける`。
 * @param removedIndex 外した画像の（外す前の）番号
 * @param remaining 外したあとに残った枚数
 */
export function focusAfterRemove(removedIndex: number, remaining: number): FocusAfterRemove {
  if (remaining <= 0) return { kind: "attach" };
  return { kind: "image", index: Math.min(Math.max(removedIndex, 0), remaining - 1) };
}
