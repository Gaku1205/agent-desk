import type { RepoResult } from "../github/types";
import type { SyncReadState } from "../loadState";

/**
 * Slots & Queue の「読めなかったときの出し方」（docs/spec.md の「読めなかったリポジトリは、空ではなく読めなかったと出す」）。
 * - `ok`：全部読めた。今までどおり
 * - `partial`：一部だけ読めなかった（または全部読めなかったが覚えている結果を出している）。読めた分は出し、「空」の文だけ出さない
 * - `failed`：全部読めなかった（出せる中身も無い）。数は `–`、空きの席の行と「空」の文は出さない
 */
export type LanesReadMode = "ok" | "partial" | "failed";

export function lanesReadMode(input: {
  /** `resolveLoadState` の `canSayEmpty` */
  canSayEmpty: boolean;
  /** `resolveLoadState` の `sync` */
  sync: SyncReadState;
  /** 出している結果 */
  results: RepoResult[];
}): LanesReadMode {
  if (input.canSayEmpty) return "ok";
  const hasContent = input.results.some((result) => result.ok);
  return input.sync === "failed" && !hasContent ? "failed" : "partial";
}
