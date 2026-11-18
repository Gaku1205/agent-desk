import type { IssueData } from "./github/types";

/** パイプラインの保守の Issue に付く目印のラベル */
export const PIPELINE_LABEL = "pipeline";
/** パイプラインの保守の Issue の本文にある印 */
const MAINTENANCE_MARK = "<!-- pipeline-maintenance -->";
/** 印が付く前の保守の Issue の題名（全角コロン） */
const MAINTENANCE_TITLE = /^AIの許可が足りない：/;

/**
 * パイプラインが自動で作る保守の Issue か（オーナーが押す物が無いので、画面に出さない）。
 * ラベル `pipeline`・本文の印・題名 `AIの許可が足りない：` のどれか
 */
export function isPipelineMaintenanceIssue(issue: Pick<IssueData, "title" | "body" | "labels">): boolean {
  return (
    issue.labels.includes(PIPELINE_LABEL) ||
    issue.body.includes(MAINTENANCE_MARK) ||
    MAINTENANCE_TITLE.test(issue.title)
  );
}
