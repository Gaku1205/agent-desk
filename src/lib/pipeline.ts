import { describeStatus } from "./describe";
import type { CommentData, RepoData } from "./github/types";
import { getProgress, type Progress } from "./progress";
import { getIssueStatus, shouldShowIssue, type IssueStatus } from "./status";

/** パイプライン表の1行 */
export type PipelineRow = {
  issue: { number: number; title: string; url: string };
  status: IssueStatus;
  /** 短い説明（今の段階のセルにだけ出す） */
  description: string;
  progress: Progress;
  /** 順番待ちの順番（1始まり）。順番待ちの行だけ。それ以外は null */
  queuePosition: number | null;
  /** 順番待ちの理由（企画AIのコメント）。順番待ちの行で、コメントがあるときだけ */
  queueReason: string | null;
};

const CLAUDE_BOT = "claude[bot]";

/** 順番待ちの理由：`claude[bot]` が書いた、そのIssueの最新のコメント（`Claude finished` を含むものは除く） */
export function getQueueReason(issueNumber: number, comments: CommentData[]): string | null {
  let latest: CommentData | null = null;
  for (const comment of comments) {
    if (comment.issueNumber !== issueNumber || comment.author !== CLAUDE_BOT) continue;
    if (comment.body.includes("Claude finished")) continue;
    if (latest === null || comment.createdAt >= latest.createdAt) latest = comment;
  }
  const text = latest?.body.trim() ?? "";
  return text === "" ? null : text;
}

/** 順番待ちの順番：Issue番号の小さい順に 1, 2, … */
export function getQueuePositions(queuedNumbers: number[]): Map<number, number> {
  const sorted = [...queuedNumbers].sort((a, b) => a - b);
  return new Map(sorted.map((number, index) => [number, index + 1]));
}

/** 見出しの横に出す件数：順番待ちの行の数と、AI作業中（実装中）の行の数 */
export function countPipelineWork(rows: PipelineRow[]): { queued: number; working: number } {
  return {
    queued: rows.filter((row) => row.status.stage === "queued").length,
    working: rows.filter((row) => row.status.stage === "implementing").length,
  };
}

/** パイプライン表の行：Issue番号が大きい順（段階が変わっても行の位置は変えない） */
export function buildPipelineRows(data: RepoData, now: Date): PipelineRow[] {
  const visible = data.issues
    .filter((issue) => shouldShowIssue(issue, data.pulls))
    .sort((a, b) => b.number - a.number);
  const statuses = new Map(visible.map((issue) => [issue.number, getIssueStatus(issue, data, now)]));
  const queuePositions = getQueuePositions(
    visible.filter((issue) => statuses.get(issue.number)?.stage === "queued").map((issue) => issue.number),
  );
  return visible.map((issue) => {
    const status = statuses.get(issue.number)!;
    const queuePosition = queuePositions.get(issue.number) ?? null;
    return {
      issue: { number: issue.number, title: issue.title, url: issue.url },
      status,
      description: queuePosition === null ? describeStatus(status).short : `順番待ち ${queuePosition}番目`,
      progress: getProgress(status),
      queuePosition,
      queueReason: queuePosition === null ? null : getQueueReason(issue.number, data.comments),
    };
  });
}

/** 表に出す行を選ぶ：showDeployed が false なら公開済みの行を除く（並び順は変えない） */
export function filterPipelineRows(rows: PipelineRow[], showDeployed: boolean): PipelineRow[] {
  if (showDeployed) return rows;
  return rows.filter((row) => row.status.stage !== "deployed");
}
