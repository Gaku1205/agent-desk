/** 名札の側へ張り出す粒を、光の近くに縮める（docs/design.md の「流れ」の粒） */

/** ここまでは縮めない（px） */
export const SQUEEZE_FREE = 9;
/** 縮めたあとの、張り出しの上限（px）。名札の文字は光から22pxの所から始まる */
export const SQUEEZE_MAX = 12;

/**
 * 光の中心から名札の側へ `distance` px の粒の位置を、`SQUEEZE_FREE` を超える分だけなだらかに縮める。
 * 名札の側とは反対（負）はそのまま。大きな画面で粒の半径が1.5倍になっても、名札の番号にかぶらない
 */
export function squeezeTowardLabel(distance: number): number {
  if (distance <= SQUEEZE_FREE) return distance;
  const room = SQUEEZE_MAX - SQUEEZE_FREE;
  return SQUEEZE_FREE + room * Math.tanh((distance - SQUEEZE_FREE) / 6);
}
