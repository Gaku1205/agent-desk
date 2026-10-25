import { describeStatus } from "./describe";
import type { RepoData } from "./github/types";
import { getProgress, type Progress } from "./progress";
import { getIssueStatus, shouldShowIssue, type IssueStatus } from "./status";

/** パイプライン表の1行 */
export type PipelineRow = {
  issue: { number: number; title: string; url: string };
  status: IssueStatus;
  /** 短い説明（今の段階のセルにだけ出す） */
  description: string;
  progress: Progress;
};

/** パイプライン表の行：Issue番号が大きい順（段階が変わっても行の位置は変えない） */
export function buildPipelineRows(data: RepoData, now: Date): PipelineRow[] {
  return data.issues
    .filter((issue) => shouldShowIssue(issue, data.pulls))
    .sort((a, b) => b.number - a.number)
    .map((issue) => {
      const status = getIssueStatus(issue, data, now);
      return {
        issue: { number: issue.number, title: issue.title, url: issue.url },
        status,
        description: describeStatus(status).short,
        progress: getProgress(status),
      };
    });
}

/** 表に出す行を選ぶ：showDeployed が false なら公開済みの行を除く（並び順は変えない） */
export function filterPipelineRows(rows: PipelineRow[], showDeployed: boolean): PipelineRow[] {
  if (showDeployed) return rows;
  return rows.filter((row) => row.status.stage !== "deployed");
}
