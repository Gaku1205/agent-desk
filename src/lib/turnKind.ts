import type { IssueStatus } from "./status";

/**
 * 「あなたの番」の4つのまとまり（docs/design.md の「あなたの番の種類と色」）。色は GitHub の Primer と同じ：
 * fix＝danger（赤）／answer＝attention（黄土）／ship＝success（緑）／start＝accent（青）
 */
export type TurnGroup = "fix" | "answer" | "ship" | "start";

/** 種類ごとの記号（形は src/components/TurnKindIcon.tsx） */
export type TurnIcon =
  | "stuck"
  | "deployFailed"
  | "notice"
  | "merge"
  | "question"
  | "factoryTalk"
  | "prPending"
  | "notStarted"
  | "onHold"
  | "pending";

/** 種類の札：英語の名前・まとまり（色）・記号。「あなたの番」の種類を出す所は全部ここから出す */
export type TurnKind = { label: string; group: TurnGroup; icon: TurnIcon };

/** 凡例に出す順（色の四角＋英語の名前。括弧で種類を足さない） */
export const TURN_GROUPS: readonly { group: TurnGroup; label: string }[] = [
  { group: "fix", label: "Fix" },
  { group: "answer", label: "Answer" },
  { group: "ship", label: "Ship" },
  { group: "start", label: "Start" },
];

export function turnKind(status: Pick<IssueStatus, "stage"> & Partial<Pick<IssueStatus, "grace">>): TurnKind {
  // パイプラインが自動で進める間（猶予）は人間の番ではない。あなたの番には出ないが、札は決めておく
  if (status.grace === "creatingPull") return { label: "PRを作成中", group: "ship", icon: "prPending" };
  if (status.grace === "intake") return { label: "受付中", group: "start", icon: "notStarted" };
  switch (status.stage) {
    case "stuck":
      return { label: "Stuck", group: "fix", icon: "stuck" };
    case "deployFailed":
      return { label: "Deploy failed", group: "fix", icon: "deployFailed" };
    case "notice":
      return { label: "Notice", group: "fix", icon: "notice" };
    case "question":
      return { label: "Question", group: "answer", icon: "question" };
    case "factoryTalk":
      return { label: "Factory talk", group: "answer", icon: "factoryTalk" };
    case "mergeWaiting":
      return { label: "Merge", group: "ship", icon: "merge" };
    case "prWaiting":
      return { label: "PR pending", group: "ship", icon: "prPending" };
    case "notStarted":
      return { label: "Not started", group: "start", icon: "notStarted" };
    case "skipped":
      return { label: "On hold", group: "start", icon: "onHold" };
    default:
      return { label: "Your turn", group: "start", icon: "pending" };
  }
}

/** 日本語の文を「。」「、」のあとで分け、塊ごとに折り返せるようにする（文節の途中で切らない） */
export function splitPhrases(text: string): string[] {
  return text.split(/(?<=[。、])/).filter((s) => s !== "");
}
