import { buildConversation } from "../conversation";
import type { RepoResult } from "../github/types";
import { buildLanesSource } from "../lanes/source";
import { buildTurnItems } from "../turn";
import type { Screen } from "./types";

/** 画面が使っている関数の結果をそのまま作る（Your turn・いまの様子・Slots & Queue）。GitHub は読まない */
export function buildScreen(results: RepoResult[], now: Date): Screen {
  return {
    turnItems: buildTurnItems(results, now),
    lanes: buildLanesSource(results, now),
    messages: buildConversation(results, [], now),
    unreadableShown: results.filter((result) => !result.ok).length,
  };
}
