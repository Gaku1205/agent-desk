/** 押す列の行が畳まれるとき、フォーカスの行き先を決める（docs/spec.md の「押す列のキーボード操作」） */

/**
 * 畳む行（from）の次から、畳んでいない最初の行の位置を返す。無ければ null（見出しへ移す）
 * @param leaving 押す列の行を上から並べたとき、各行が畳まれているか
 */
export function nextRowIndex(leaving: readonly boolean[], from: number): number | null {
  for (let i = from + 1; i < leaving.length; i += 1) {
    if (!leaving[i]) return i;
  }
  return null;
}
