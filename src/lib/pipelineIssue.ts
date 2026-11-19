import type { IssueData } from "./github/types";

/** パイプラインの保守の Issue に付く目印のラベル */
export const PIPELINE_LABEL = "pipeline";
/** パイプラインの保守の Issue の本文にある印 */
const MAINTENANCE_MARK = "<!-- pipeline-maintenance -->";
/** 印が付く前の保守の Issue の題名（全角コロン） */
const MAINTENANCE_TITLE = /^AIの許可が足りない：/;

/** パイプラインが Issue を立てるときの作者（Bot は `[bot]` 付き） */
export const PIPELINE_AUTHORS: readonly string[] = ["gaku-ai-pipeline[bot]", "github-actions[bot]"];

/**
 * パイプラインが自分で立てる「知らせ」の Issue か：開いていて `ai:skip` があり、
 * 作った人がパイプライン。作った人が無い（取れない）ときは false
 */
export function isPipelineNotice(issue: Pick<IssueData, "state" | "labels" | "author">): boolean {
  return (
    issue.state === "open" &&
    issue.labels.includes("ai:skip") &&
    issue.author !== undefined &&
    PIPELINE_AUTHORS.includes(issue.author)
  );
}

/** 印は本文の頭に入る（パイプラインが書く）。本文の途中で印の文字を説明しているだけの Issue は保守の Issue にしない */
function hasMaintenanceMark(body: string): boolean {
  return body.trimStart().startsWith(MAINTENANCE_MARK);
}

/**
 * パイプラインが自動で作る保守の Issue か（オーナーが押す物が無いので、画面に出さない）。
 * ラベル `pipeline`・本文の印・題名 `AIの許可が足りない：` のどれか
 */
export function isPipelineMaintenanceIssue(issue: Pick<IssueData, "title" | "body" | "labels">): boolean {
  return (
    issue.labels.includes(PIPELINE_LABEL) ||
    hasMaintenanceMark(issue.body) ||
    MAINTENANCE_TITLE.test(issue.title)
  );
}
