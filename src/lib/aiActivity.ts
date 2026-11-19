import type { CommentData, RepoData, RunStepData, WorkflowRunData } from "./github/types";
import { isFactoryTitle } from "./factoryIssue";
import { isFactoryRun } from "./factoryStage";
import { isRelatedRun } from "./lamp";
import { isLinkedPull, latestFixRun } from "./status";

/**
 * 「AIが今していること」（docs/spec.md の「いまの様子」の「AIが今していること」）。
 * AIのアクション（`claude[bot]`）が作業中に書いて更新し続けるコメントの、やることの一覧を読む。
 * コメントが無ければ、動いているワークフローの今のステップ名
 */

/** やることの一覧の1項目（`- [x] 〇〇`・`- [ ] 〇〇`） */
export type TaskItem = { done: boolean; text: string };

export type AiActivity =
  /** 作業中のコメント。current は最初の終わっていない項目（無ければ null）。total が0なら数は出さない */
  | { kind: "todo"; current: string | null; done: number; total: number; url: string }
  /** 動いているワークフローの今のステップ名 */
  | { kind: "step"; name: string; url: string | null };

const BOT = "claude[bot]";
const WORKING_MARK = "Claude Code is working";
/** 完了・エラーで終わったコメントの頭（アクションが付ける） */
const FINISHED_MARKS = ["Claude finished", "Claude encountered an error"];
const HUMAN_REQUEST_MARK = "<!-- human-request -->";
const TASK_LINE = /^\s*[-*]\s+\[([ xX])\]\s+(.+?)\s*$/;

/** コメントの本文から、やることの一覧を読む（上から順） */
export function readTaskList(body: string): TaskItem[] {
  const items: TaskItem[] = [];
  for (const line of body.split(/\r?\n/)) {
    const match = line.match(TASK_LINE);
    if (!match) continue;
    const text = plainText(match[2]);
    if (text === "") continue;
    items.push({ done: match[1] !== " ", text });
  }
  return items;
}

/** 一覧の項目の飾り（太字・コード・打ち消し）を外す */
function plainText(text: string): string {
  return text.replace(/\*\*|__|~~|`/g, "").trim();
}

/** 完了した（`Claude finished …`・エラーで終わった）コメント */
export function isFinishedComment(body: string): boolean {
  return FINISHED_MARKS.some((mark) => body.includes(mark));
}

/** AIのアクションが作業中に更新し続けるコメント（完了した物も含む）か */
export function isTrackingComment(comment: CommentData): boolean {
  if (comment.author !== BOT) return false;
  if (comment.body.includes(HUMAN_REQUEST_MARK)) return false;
  if (isFinishedComment(comment.body)) return true;
  return comment.body.includes(WORKING_MARK) || readTaskList(comment.body).length > 0;
}

function touched(comment: CommentData): string {
  return comment.updatedAt ?? comment.createdAt;
}

/**
 * この Issue（と紐づく PR）の、いちばん新しく更新された作業中のコメント。
 * いちばん新しい物が完了していれば null（完了したコメントは出さない）
 */
export function pickWorkingComment(
  comments: CommentData[],
  numbers: number[],
  runs?: WorkflowRunData[] | null,
  pulls: { number: number; headRef: string }[] = [],
): CommentData | null {
  let latest: CommentData | null = null;
  for (const comment of comments) {
    if (!numbers.includes(comment.issueNumber) || !isTrackingComment(comment)) continue;
    if (latest === null || touched(comment) > touched(latest) || (touched(comment) === touched(latest) && comment.id > latest.id)) {
      latest = comment;
    }
  }
  if (latest === null || isFinishedComment(latest.body)) return null;
  if (isFromBrokenFixRun(latest, runs, pulls)) return null;
  return latest;
}

/** 取り消し・失敗・時間切れで終わった修正AIの実行が書いた、終わっていない（`Claude finished` にならなかった）コメントか */
function isFromBrokenFixRun(
  comment: CommentData,
  runs: WorkflowRunData[] | null | undefined,
  pulls: { number: number; headRef: string }[],
): boolean {
  const pull = pulls.find((item) => item.number === comment.issueNumber);
  if (!pull) return false;
  const run = latestFixRun(runs, pull.headRef);
  if (!run || run.status !== "completed" || !["cancelled", "failure", "timed_out"].includes(run.conclusion ?? "")) {
    return false;
  }
  // その実行が始まる前のコメントは、別の実行の物
  const started = Date.parse(run.startedAt ?? run.updatedAt);
  return Number.isNaN(started) || Date.parse(touched(comment)) >= started;
}

/** コメントへのリンク。型に URL が無ければ、Issue のページのコメントの位置を作る（PR は GitHub が移してくれる） */
export function commentUrl(comment: CommentData, owner: string, repo: string): string {
  return comment.url ?? `https://github.com/${owner}/${repo}/issues/${comment.issueNumber}#issuecomment-${comment.id}`;
}

/** 作業中のコメントから「いまのやること」を作る */
export function todoActivity(comment: CommentData, owner: string, repo: string): AiActivity {
  const items = readTaskList(comment.body);
  return {
    kind: "todo",
    current: items.find((item) => !item.done)?.text ?? null,
    done: items.filter((item) => item.done).length,
    total: items.length,
    url: commentUrl(comment, owner, repo),
  };
}

/** Issue と紐づく PR の番号・ブランチ */
function linkedPulls(data: RepoData, issueNumber: number): { number: number; headRef: string }[] {
  return data.pulls.filter((pull) => isLinkedPull(pull, issueNumber));
}

/** 関わる実行中の実行（新しく更新された順） */
function activeRuns(runs: WorkflowRunData[] | null | undefined, issueNumber: number, pulls: { number: number; headRef: string }[]) {
  return (runs ?? [])
    .filter((run) => run.status === "in_progress" && typeof run.id === "number" && isRelatedRun(run, issueNumber, pulls))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/**
 * 1件の Issue の「AIが今していること」。作業中のコメントがあればそれ、
 * 無ければ関わる実行中の実行の今のステップ名、どちらも無ければ null
 */
export function aiActivity(data: RepoData, issueNumber: number, owner: string, repo: string): AiActivity | null {
  const pulls = linkedPulls(data, issueNumber);
  const comment = pickWorkingComment(data.comments, [issueNumber, ...pulls.map((pull) => pull.number)], data.runs, pulls);
  if (comment) return todoActivity(comment, owner, repo);
  const steps = new Map((data.runSteps ?? []).map((step) => [step.runId, step]));
  for (const run of activeRuns(data.runs, issueNumber, pulls)) {
    const step = steps.get(run.id!);
    if (step) return { kind: "step", name: step.name, url: step.url };
  }
  return null;
}

/** 工場の Issue（`新サービス：`）に対する、動いている工場の実行のいちばん新しい1件（Issue 番号では紐づかない。docs/spec.md の「工場の今の段」） */
function factoryActiveRun(data: RepoData, title: string): WorkflowRunData | undefined {
  if (!isFactoryTitle(title)) return undefined;
  return (data.runs ?? [])
    .filter((run) => run.status === "in_progress" && typeof run.id === "number" && isFactoryRun(run))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
}

/** 1回の同期でステップ名を取りに行く実行の数の上限（リポジトリごと） */
export const STEP_PROBE_MAX = 3;

/**
 * ステップ名を取りに行く実行の ID（`actions/runs/{run_id}/jobs`）。
 * 開いている Issue のうち、関わる実行が実行中で、作業中のコメントが無い物の、いちばん新しい実行だけ（上限 `STEP_PROBE_MAX`）
 */
export function stepProbeRunIds(data: RepoData): number[] {
  const ids: number[] = [];
  for (const issue of data.issues) {
    if (ids.length >= STEP_PROBE_MAX) break;
    if (issue.state !== "open") continue;
    const pulls = linkedPulls(data, issue.number);
    const run = activeRuns(data.runs, issue.number, pulls)[0] ?? factoryActiveRun(data, issue.title);
    if (!run || ids.includes(run.id!)) continue;
    if (pickWorkingComment(data.comments, [issue.number, ...pulls.map((pull) => pull.number)], data.runs, pulls)) continue;
    ids.push(run.id!);
  }
  return ids;
}

/** `actions/runs/{run_id}/jobs` の返事から、今のステップ（`in_progress` の物）を読む。無ければ null */
export function currentStepFromJobs(runId: number, raw: unknown): RunStepData | null {
  const jobs = (raw as { jobs?: unknown } | null)?.jobs;
  if (!Array.isArray(jobs)) return null;
  for (const job of jobs) {
    const value = job as { status?: unknown; html_url?: unknown; steps?: unknown; name?: unknown } | null;
    if (value?.status !== "in_progress" || !Array.isArray(value.steps)) continue;
    for (const step of value.steps) {
      const s = step as { status?: unknown; name?: unknown } | null;
      if (s?.status === "in_progress" && typeof s.name === "string" && s.name.trim() !== "") {
        return {
          runId,
          name: s.name.trim(),
          url: typeof value.html_url === "string" ? value.html_url : null,
          ...(typeof value.name === "string" ? { jobName: value.name } : {}),
        };
      }
    }
  }
  return null;
}
