import type { BuildMemo } from "../buildMemo";
import { buildConversation } from "../conversation";
import type { RepoResult } from "../github/types";
import { buildLanesSource } from "../lanes/source";
import { resolveLoadState } from "../loadState";
import { buildTurnItems } from "../turn";
import type { Screen } from "./types";

/**
 * 画面が使っている関数の結果をそのまま作る（Your turn・いまの様子・Slots & Queue）。GitHub は読まない。
 * `memo` を渡すと、レイアウトが作った物（同じ結果・同じ時刻）を使い回す（`/api/timing` がレイアウトと合わせて数えるため）
 */
export function buildScreen(results: RepoResult[], now: Date, memo?: BuildMemo): Screen {
  return {
    turnItems: memo ? memo.turnItems(results, now) : buildTurnItems(results, now),
    lanes: memo ? memo.lanesSource(results, now) : buildLanesSource(results, now),
    messages: buildConversation(results, [], now),
    // 画面が「読めなかった」の行を出すときの元（`resolveLoadState` の `errors`。作業の行は含めない）
    unreadableShown: resolveLoadState(
      results.map((fresh) => ({ fresh, stale: null })),
      now,
    ).errors.filter((error) => !error.work).length,
  };
}
