import type { RepoResult } from "./github/types";
import { buildPipelineRows, type PipelineRow } from "./pipeline";
import type { Stage } from "./status";
import type { TurnCounts } from "./turn";

/** ホームの「実行中のパイプライン」の1行（どのリポジトリの物かを持つ） */
export type RunningPipelineRow = PipelineRow & { owner: string; repo: string };

/** 実行中として出す段階：AIの番で動いている物（企画中・AI作業中・CI中・レビュー中・修正中・公開中） */
const RUNNING_STAGES: ReadonlySet<Stage> = new Set<Stage>([
  "planning",
  "implementing",
  "ciRunning",
  "reviewing",
  "fixing",
  "deploying",
]);

/** 実行中のパイプラインに出す段階か（あなたの番・順番待ち・公開済み・止まった物は出さない） */
export function isRunningStage(stage: Stage): boolean {
  return RUNNING_STAGES.has(stage);
}

/** サイドバーに出す実行中の件数（ホーム全体と、`owner/repo`（小文字）ごと）。ホームの表の行数と同じ数え方 */
export function countRunningPipelineRows(results: RepoResult[], now: Date): TurnCounts {
  const rows = buildRunningPipelineRows(results, now);
  const byRepo: Record<string, number> = {};
  for (const row of rows) {
    const key = `${row.owner}/${row.repo}`.toLowerCase();
    byRepo[key] = (byRepo[key] ?? 0) + 1;
  }
  return { total: rows.length, byRepo };
}

/** 全リポジトリの実行中のパイプライン：Issue番号が大きい順（同じ番号ならリポジトリ名の順）。取れなかったリポジトリは飛ばす */
export function buildRunningPipelineRows(results: RepoResult[], now: Date): RunningPipelineRow[] {
  const rows: RunningPipelineRow[] = [];
  for (const result of results) {
    if (!result.ok) continue;
    for (const row of buildPipelineRows(result.data, now, `${result.owner}/${result.repo}`)) {
      if (isRunningStage(row.status.stage)) rows.push({ ...row, owner: result.owner, repo: result.repo });
    }
  }
  return rows.sort(
    (a, b) =>
      b.issue.number - a.issue.number ||
      `${a.owner}/${a.repo}`.localeCompare(`${b.owner}/${b.repo}`),
  );
}
