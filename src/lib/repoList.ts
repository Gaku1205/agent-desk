import type { WatchedRepo } from "./config";
import type { DeployLink } from "./deployStatus";
import { buildTrailEvents } from "./events";
import type { RepoResult } from "./github/types";
import { buildPipelineRows } from "./pipeline";
import { countRunningPipelineRows } from "./runningPipeline";
import { findLinkedPull } from "./status";
import { countTurnItems, formatWait, type TurnItem } from "./turn";

const DAY_MS = 24 * 60 * 60 * 1000;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 「すべてのリポジトリ」（`/repos`）の1行 */
export type RepoListRow = {
  owner: string;
  repo: string;
  /** あなたの番の数 */
  turn: number;
  /** AIの番（動いている）の数 */
  running: number;
  /** 最後に動いた時刻（最後の出来事。ISO文字列。無ければ null） */
  lastAt: string | null;
  githubUrl: string;
  /** 公開先のリンク（公開済みの最新が成功のときだけ） */
  links: DeployLink[];
  /** 読めなかった（あなたの番・AIの数は 0 ではなく「–」で出す。最後の動きは `—`） */
  unreadable?: boolean;
};

/**
 * 並び：あなたの番（多い順）→ AIの番（多い順）→ 最後に動いた時刻（新しい順。無い物は最後）→ 名前。
 * 入力は変えない
 */
export function sortRepoRows<T extends Pick<RepoListRow, "owner" | "repo" | "turn" | "running" | "lastAt">>(
  rows: T[],
): T[] {
  return [...rows].sort(
    (a, b) =>
      b.turn - a.turn ||
      b.running - a.running ||
      (b.lastAt ?? "").localeCompare(a.lastAt ?? "") ||
      `${a.owner}/${a.repo}`.localeCompare(`${b.owner}/${b.repo}`),
  );
}

/**
 * 最後に動いた時刻の表示：無ければ `—`、24時間以内は `3時間前`、今年は `11/18 09:07`、
 * 去年以前は `2025/11/18 09:07`（日本時間）
 */
export function formatLastActivity(at: string | null, now: Date): string {
  if (at === null) return "—";
  const time = Date.parse(at);
  if (Number.isNaN(time)) return "—";
  if (now.getTime() - time < DAY_MS) return formatWait(at, now) + "前";
  const jst = new Date(time + JST_OFFSET_MS).toISOString();
  const year = jst.slice(0, 4);
  const thisYear = new Date(now.getTime() + JST_OFFSET_MS).toISOString().slice(0, 4);
  const monthDay = jst.slice(5, 10).replace("-", "/") + " " + jst.slice(11, 16);
  return year === thisYear ? monthDay : year + "/" + monthDay;
}

/** 公開済みの最新（PRのマージが新しい物）の公開先のリンク。最新に成功のリンクが無ければ空 */
function latestDeployLinks(result: RepoResult, now: Date): DeployLink[] {
  if (!result.ok) return [];
  const deployed = buildPipelineRows(result.data, now, result.repo)
    .filter((row) => row.status.stage === "deployed")
    .map((row) => ({
      row,
      mergedAt: findLinkedPull(result.data.pulls, row.issue.number)?.mergedAt ?? "",
    }))
    .sort((a, b) => b.mergedAt.localeCompare(a.mergedAt) || b.row.issue.number - a.row.issue.number);
  return deployed[0]?.row.deployLinks ?? [];
}

/**
 * `/repos` の行（並べ替え前）。取得済みの結果から作り、GitHub は読まない。
 * 取れなかったリポジトリは `unreadable`（数は画面で「–」）・時刻なし
 */
export function buildRepoRows(
  repos: WatchedRepo[],
  results: RepoResult[],
  items: TurnItem[],
  now: Date,
): RepoListRow[] {
  const turns = countTurnItems(items);
  const running = countRunningPipelineRows(results, now);
  return repos.map(({ owner, repo }) => {
    const key = `${owner}/${repo}`.toLowerCase();
    const result = results.find((r) => `${r.owner}/${r.repo}`.toLowerCase() === key);
    const lastAt = result?.ok ? (buildTrailEvents(results, now, { owner, repo })[0]?.at ?? null) : null;
    return {
      owner,
      repo,
      turn: turns.byRepo[key] ?? 0,
      running: running.byRepo[key] ?? 0,
      lastAt,
      githubUrl: "https://github.com/" + owner + "/" + repo,
      links: result ? latestDeployLinks(result, now) : [],
      ...(result && !result.ok ? { unreadable: true } : {}),
    };
  });
}
