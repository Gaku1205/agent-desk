/** 取り直した結果、行の段階が変わったか（前の段階が分からない＝初めて見る行は変わった扱いにしない） */
export function stageChanged(previous: string | null, next: string): boolean {
  return previous !== null && previous !== next;
}

/**
 * 行をフェードインさせるか。取り直しが終わった後のページに新しく入った行だけが対象。
 * 画面を開いたときや、ページを移ったときの行は対象にしない
 */
export function shouldFadeIn(refreshCountOnPage: number): boolean {
  return refreshCountOnPage > 0;
}
