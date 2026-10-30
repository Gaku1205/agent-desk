import type { IssueStatus } from "./status";

/**
 * 押す列の行頭の「種類」の札（docs/design.md の「押す列」）。あなたの番に出る段階だけ。
 * tone：human＝止まった（強いアンバー）／fail＝公開失敗（強い赤）／calm＝それ以外（静かな色。強い色はこの2つだけ）
 */
export type TurnKind = { label: string; tone: "human" | "fail" | "calm" };

export function turnKind(status: Pick<IssueStatus, "stage"> & Partial<Pick<IssueStatus, "grace">>): TurnKind {
  // パイプラインが自動で進める間（猶予）は人間の番ではない。押す列には出ないが、札の文言は決めておく
  if (status.grace === "creatingPull") return { label: "PRを作成中", tone: "calm" };
  if (status.grace === "intake") return { label: "受付中", tone: "calm" };
  switch (status.stage) {
    case "stuck":
      return { label: "止まった", tone: "human" };
    case "skipped":
      return { label: "保留", tone: "calm" };
    case "notStarted":
      return { label: "未着手", tone: "calm" };
    case "prWaiting":
      return { label: "PR作成待ち", tone: "calm" };
    case "mergeWaiting":
      return { label: "マージ待ち", tone: "calm" };
    case "deployFailed":
      return { label: "公開失敗", tone: "fail" };
    default:
      return { label: "あなたの番", tone: "calm" };
  }
}

/** 日本語の文を「。」「、」のあとで分け、塊ごとに折り返せるようにする（文節の途中で切らない） */
export function splitPhrases(text: string): string[] {
  return text.split(/(?<=[。、])/).filter((s) => s !== "");
}
