import { deployFailureReason } from "./deployFailure";
import { deployLinks, type DeployLink } from "./deployStatus";
import { describeStatus } from "./describe";
import { failureReasonText, parseFailureReason } from "./failureReason";
import type { CommentData, RepoData } from "./github/types";
import { getProgress, type Progress } from "./progress";
import { findLinkedPull, getIssueStatus, shouldShowIssue,type IssueStatus } from "./status";

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
  /** 公開失敗の理由（公開ステータスの description）。公開失敗の行で、description があるときだけ */
  deployFailReason: string | null;
  /** 公開先へのリンク（`開く ↗` など）。公開済みの行で、success の `target_url` が `https://` で始まる物だけ */
  deployLinks: DeployLink[];
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

/** 理由の文からログのURLを外し、`{説明}（{原因}）` にする */
function queueReasonText(reason: string | null, repo: string): string | null {
  return reason === null ? null : failureReasonText(parseFailureReason(reason, repo));
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

function failReason(issueNumber: number, data: RepoData): string | null {
  const pull = findLinkedPull(data.pulls, issueNumber);
  return pull ? deployFailureReason(data.pullChecks[pull.number]?.statuses ?? []) : null;
}

function deployedLinks(issueNumber: number, data: RepoData): DeployLink[] {
  const pull = findLinkedPull(data.pulls, issueNumber);
  return pull ? deployLinks(data.pullChecks[pull.number]?.statuses ?? []) : [];
}

/** パイプライン表の行：Issue番号が大きい順（段階が変わっても行の位置は変えない） */
export function buildPipelineRows(data: RepoData, now: Date, repo = ""): PipelineRow[] {
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
      queueReason: queuePosition === null ? null : queueReasonText(getQueueReason(issue.number, data.comments), repo),
      deployFailReason: status.stage === "deployFailed" ? failReason(issue.number, data) : null,
      deployLinks: status.stage === "deployed" ? deployedLinks(issue.number, data) : [],
    };
  });
}

/** 表に出す行を選ぶ：showDeployed が false なら公開済みの行を除く（並び順は変えない） */
export function filterPipelineRows(rows: PipelineRow[], showDeployed: boolean): PipelineRow[] {
  if (showDeployed) return rows;
  return rows.filter((row) => row.status.stage !== "deployed");
}

/** 公開済みを1回押すごとに足して出す件数 */
export const DEPLOYED_PAGE_SIZE = 5;

export type PipelineView = {
  /** 表に出す行：まだ終わっていない行（番号の大きい順）の下に、出すと決めた公開済みの行 */
  rows: PipelineRow[];
  /** 公開済みの行の総数 */
  deployedTotal: number;
  /** 出している公開済みの行の数 */
  deployedShown: number;
  /** まだ出していない公開済みの行の数 */
  deployedRemaining: number;
};

/** 表に出す行を選ぶ：公開済みは新しい順に deployedShown 件まで（範囲外の値は丸める） */
export function getPipelineView(rows: PipelineRow[], deployedShown: number): PipelineView {
  const active = filterPipelineRows(rows, false);
  const deployed = rows.filter((row) => row.status.stage === "deployed");
  const shown = Math.min(Math.max(0, Math.floor(deployedShown)), deployed.length);
  return {
    rows: [...active, ...deployed.slice(0, shown)],
    deployedTotal: deployed.length,
    deployedShown: shown,
    deployedRemaining: deployed.length - shown,
  };
}

/** 公開済みを出す件数を1回分増やす（総数を超えない） */
export function showMoreDeployed(deployedShown: number, deployedTotal: number): number {
  return Math.min(deployedShown + DEPLOYED_PAGE_SIZE, deployedTotal);
}

/** 公開済みの開閉ボタンの文言：1件も出していないとき／残りがあるとき。残りが無ければ null */
export function deployedMoreLabel(view: PipelineView): string | null {
  if (view.deployedRemaining === 0) return null;
  if (view.deployedShown === 0) return `公開済みを表示（${view.deployedTotal}件）`;
  return `さらに${DEPLOYED_PAGE_SIZE}件表示（残り${view.deployedRemaining}件）`;
}
