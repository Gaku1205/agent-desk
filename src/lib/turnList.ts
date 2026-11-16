import { turnItemKey, type TurnItem } from "./turn";

/** 残りがこの件数以上のとき、一覧を畳める・開ける（docs/spec.md の「残りの一覧」） */
export const TURN_LIST_FOLD_FROM = 6;

/** 一覧を畳める件数か */
export function isTurnListFoldable(restCount: number): boolean {
  return restCount >= TURN_LIST_FOLD_FROM;
}

/**
 * 大きく出す1件：選んだ物（まだ待っている物だけ）があればそれ、無ければ並び順の先頭。
 * 選んだ物が片づいた・取り直しで消えたら、並び順の先頭に戻る
 * @param waiting 並び順（`compareTurnItems`）のままの、片づけていない物
 */
export function pickTurn<T extends Pick<TurnItem, "owner" | "repo" | "issue">>(
  waiting: readonly T[],
  picked: string | null,
): T | null {
  if (picked !== null) {
    const chosen = waiting.find((item) => turnItemKey(item) === picked);
    if (chosen) return chosen;
  }
  return waiting[0] ?? null;
}
