import type { RepoData } from "./github/types";
import { buildPipelineRows } from "./pipeline";
import { isPipelineMaintenanceIssue } from "./pipelineIssue";

/** どの区画にも出ない作業につける文言（docs/spec.md の「状態が読めない」） */
export const UNREADABLE_WORK_TEXT = "状態が読めない";

export type UnreadableWork = { repo: string; number: number; message: string };

/**
 * どの区画にも出ていない作業を探す：`ai:*` が付いた開いている Issue と、`claude/` の開いている PR のうち、
 * パイプライン表の行（Issue）にも、行の紐づくPRにも当たらない物。黙って落とさず `状態が読めない` として出すための材料
 */
export function findUnreadableWork(owner: string, repo: string, data: RepoData, now: Date): UnreadableWork[] {
  const rows = buildPipelineRows(data, now, `${owner}/${repo}`);
  const shownIssues = new Set(rows.map((row) => row.issue.number));
  const shownPulls = new Set(rows.flatMap((row) => (row.status.pull ? [row.status.pull.number] : [])));
  const found: UnreadableWork[] = [];
  for (const issue of data.issues) {
    if (issue.state !== "open" || shownIssues.has(issue.number)) continue;
    if (isPipelineMaintenanceIssue(issue)) continue;
    if (!issue.labels.some((label) => label.startsWith("ai:"))) continue;
    found.push({ repo: `${owner}/${repo}`, number: issue.number, message: `#${issue.number} ${UNREADABLE_WORK_TEXT}` });
  }
  for (const pull of data.pulls) {
    if (pull.state !== "open" || shownPulls.has(pull.number)) continue;
    if (!pull.headRef.startsWith("claude/")) continue;
    found.push({ repo: `${owner}/${repo}`, number: pull.number, message: `PR #${pull.number} ${UNREADABLE_WORK_TEXT}` });
  }
  return found;
}
