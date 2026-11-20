/** 配布（テンプレート更新）の取り込みの枝の名前の始まり（`status.ts` の `isPipelineSyncPull` と同じ） */
const PIPELINE_SYNC = "pipeline-sync/";

/** マージのコミットの文：`Merge pull request #19 from Gaku1205/pipeline-sync/c1015bd` */
const MERGE_TITLE = /^Merge pull request #(\d+) from (\S+)$/;

/**
 * Background の行に出す「今していること」の文（Issue #720）。
 * マージのコミットの文のときは、その PR の題名を出す。PR の題名が読めなければ、
 * 枝が `pipeline-sync/` なら `パイプラインの更新を取り込む`、ほかは `#N のマージ`。
 * それ以外の題名はそのまま。空なら null
 */
export function backgroundTitle(displayTitle: string, pulls: readonly { number: number; title: string }[]): string | null {
  const text = displayTitle.trim();
  if (text === "") return null;
  const match = MERGE_TITLE.exec(text);
  if (!match) return text;
  const number = Number(match[1]);
  const pull = pulls.find((candidate) => candidate.number === number);
  const pullTitle = pull?.title.trim() ?? "";
  if (pullTitle !== "") return pullTitle;
  // `owner/branch` の branch の部分（owner の後の `/` より後）で配布かどうかを決める
  const branch = match[2].split("/").slice(1).join("/");
  return branch.startsWith(PIPELINE_SYNC) ? "パイプラインの更新を取り込む" : `#${number} のマージ`;
}
