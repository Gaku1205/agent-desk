import type { IssueStatus } from "./status";

/** 押す列の行頭の「種類」の札（docs/design.md の「押す列」）。あなたの番に出る段階だけ */
export type TurnKind = { label: string; tone: "human" | "fail" };

export function turnKind(status: Pick<IssueStatus, "stage">): TurnKind {
  switch (status.stage) {
    case "stuck":
      return { label: "止まった", tone: "human" };
    case "skipped":
      return { label: "保留", tone: "human" };
    case "notStarted":
      return { label: "未着手", tone: "human" };
    case "prWaiting":
      return { label: "PR作成待ち", tone: "human" };
    case "mergeWaiting":
      return { label: "マージ待ち", tone: "human" };
    case "deployFailed":
      return { label: "公開失敗", tone: "fail" };
    default:
      return { label: "あなたの番", tone: "human" };
  }
}

/** 日本語の文を「。」「、」のあとで分け、塊ごとに折り返せるようにする（文節の途中で切らない） */
export function splitPhrases(text: string): string[] {
  return text.split(/(?<=[。、])/).filter((s) => s !== "");
}
