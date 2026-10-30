/** 巨大な数字の字面の右端から「件」までの間（px。docs/design.md） */
export const GIANT_UNIT_GAP = 6;

/** 「件」の左端の位置（数字の箱の左端から測る）：字面の右端＋間 */
export function unitLeft(inkRight: number, gap: number = GIANT_UNIT_GAP): number {
  return inkRight + gap;
}

/**
 * 「件」を、グリッドの置き場所（箱の右端＋列の間）から動かす量（px）。
 * 箱の幅は転がり中の大きいほうの幅なので、字面の右端とは一致しない。その差を埋める
 */
export function unitShift(inkRight: number, boxWidth: number, columnGap: number, gap: number = GIANT_UNIT_GAP): number {
  return unitLeft(inkRight, gap) - (boxWidth + columnGap);
}

/**
 * 字面の右端（箱の左端から）。
 * `boundingRight`：字間 0 で測った `actualBoundingBoxRight`、`boundingLeft`：`actualBoundingBoxLeft`、
 * `letterSpacing`：1字ごとの字間（負の値）、`length`：字数、`pad`：描き始めの余白
 */
export function inkRightOf(boundingRight: number, boundingLeft: number, letterSpacing: number, length: number, pad: number): number {
  return pad + boundingLeft + boundingRight + letterSpacing * Math.max(0, length - 1);
}
