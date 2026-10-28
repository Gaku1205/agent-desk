import type { RepoResult } from "./github/types";
import { buildPipelineRows } from "./pipeline";
import type { RunningPipelineRow } from "./runningPipeline";
import type { Stage } from "./status";

/** ホームの「待機中のパイプライン」の1行（実行中の行と同じ形） */
export type WaitingPipelineRow = RunningPipelineRow;

/** 待機中として出す段階：順番待ち・やり直し待ち（AIも人間も今は手を動かしていない物） */
const WAITING_STAGES: ReadonlySet<Stage> = new Set<Stage>(["queued", "retrying"]);

/** 待機中のパイプラインに出す段階か */
export function isWaitingStage(stage: Stage): boolean {
  return WAITING_STAGES.has(stage);
}

/** 全リポジトリの待機中のパイプライン：待っている時間が長い順（`updatedAt` の古い順。同じならIssue番号の小さい順、リポジトリ名の順）。取れなかったリポジトリは飛ばす */
export function buildWaitingPipelineRows(results: RepoResult[], now: Date): WaitingPipelineRow[] {
  const entries: { row: WaitingPipelineRow; waitingSince: number }[] = [];
  for (const result of results) {
    if (!result.ok) continue;
    const updatedAtByNumber = new Map(result.data.issues.map((issue) => [issue.number, Date.parse(issue.updatedAt)]));
    for (const row of buildPipelineRows(result.data, now, `${result.owner}/${result.repo}`)) {
      if (!isWaitingStage(row.status.stage)) continue;
      entries.push({
        row: { ...row, owner: result.owner, repo: result.repo },
        waitingSince: updatedAtByNumber.get(row.issue.number) ?? 0,
      });
    }
  }
  return entries
    .sort(
      (a, b) =>
        a.waitingSince - b.waitingSince ||
        a.row.issue.number - b.row.issue.number ||
        `${a.row.owner}/${a.row.repo}`.localeCompare(`${b.row.owner}/${b.row.repo}`),
    )
    .map((entry) => entry.row);
}
