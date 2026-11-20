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

/** まとまりの英語の名前（`Fix`・`Answer`・`Ship`・`Start`） */
export function groupLabel(group: TurnGroup): string {
  return TURN_GROUPS.find((g) => g.group === group)?.label ?? "";
}

/** 決める画面の札の「誰から」（質問＝企画AIから・工場の相談＝工場から。ほかは無し） */
export function turnSource(stage: IssueStatus["stage"]): string | null {
  if (stage === "question") return "企画AIから";
  if (stage === "factoryTalk") return "工場から";
  return null;
}

/** 題名を「何が起きたか」にする種類（公開の失敗・止まった物） */
export function titlesWhatHappened(stage: IssueStatus["stage"]): boolean {
  return stage === "deployFailed" || stage === "stuck";
}

/** 右の Your turn の列の「中身の手がかり」（公開の失敗・止まった・3問）。無ければ null */
export function turnHint(stage: IssueStatus["stage"], questionCount: number): string | null {
  if (stage === "deployFailed") return "公開の失敗";
  if (stage === "stuck") return "止まった";
  if (stage === "question" && questionCount > 0) return `${questionCount}問`;
  return null;
}

/** 日本語の文を「。」「、」のあとで分け、塊ごとに折り返せるようにする（文節の途中で切らない） */
export function splitPhrases(text: string): string[] {
  return text.split(/(?<=[。、])/).filter((s) => s !== "");
}
