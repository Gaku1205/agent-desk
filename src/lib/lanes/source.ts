import { aiActivity } from "../aiActivity";
import { ciFailureState } from "../ciFailureState";
import { queueAfterNumber } from "../conversation";
import { usageModel } from "../dashboard/aiUsage";
import { parseRunRows } from "../dashboard/summary";
import { FLOW_STEPS, getFlow, type FlowStepKey } from "../flow";
import type { RepoData, RepoResult, WorkflowRunData } from "../github/types";
import { parseHoldBlocking } from "../holdBlocking";
import { pausedMark } from "../paused";
import { buildPipelineRows } from "../pipeline";
import { findLinkedPull, isLinkedPull, type IssueStatus } from "../status";
import { isStepLogComment } from "../stepLog";
import { parseTouches, touchesOverlap } from "./touches";

/**
 * Slots & Queue（`/lanes`）の材料（docs/spec.md の「Slots & Queue」）。
 * 取得済みの結果（`loadTurns` の `results`）だけから作る。GitHub は読まない
 */

/** 枠を使っている作業（1件の Issue） */
export type SlotWork = {
  key: string;
  owner: string;
  repo: string;
  number: number;
  title: string;
  url: string;
  /** 今の工程の文（`実装しています` など） */
  stepText: string;
  /** 進捗図の今の工程の位置（0〜6） */
  stepAt: number;
  /** 今の工程の名前（`実装`） */
  stepName: string;
  /** 今の工程が始まってからの時間（進捗ログから。記録が無ければ null） */
  elapsedMs: number | null;
  /** 触るファイル（PRがあれば変更ファイル、無ければ Issue の印）。分からなければ null */
  touches: string[] | null;
};

/** 待つ理由のうち、枠の数に関係なく決まる物 */
export type QueueCause = "blocked" | "hold" | "noTouches" | "overlap" | "unknownInflight";

/** 待つ相手（Issue か PR） */
export type WaitFor = { label: string; url: string };

/** 順番待ちの1件（理由の最終の形は `assignSlots` が枠の数を見て決める） */
export type QueueSource = {
  key: string;
  owner: string;
  repo: string;
  number: number;
  title: string;
  url: string;
  /** 入れない理由。null なら、枠が空いていれば入れる */
  cause: QueueCause | null;
  /** 重なる触るファイル（分かるときだけ） */
  file: string | null;
  waitFor: WaitFor | null;
  /** `ai:queue`・`ai:blocked` が最後に付いてからの時間（取れなければ null） */
  waitingMs: number | null;
};

/** いま動いている Actions の実行の1行 */
export type RunEntry = {
  key: string;
  /** 種類（`Implement`・`Review`・…。知らないワークフローは名前のまま） */
  kind: string;
  owner: string;
  repo: string;
  issueNumber: number | null;
  pullNumber: number | null;
  /** 今していること（「AIが今していること」。無ければ実行の題名。それも無ければ null） */
  activity: string | null;
  /** 工程・モデル（`実装 · Opus`）。出す物が無ければ null */
  detail: string | null;
  /** 実行が始まってからの時間（取れなければ null） */
  elapsedMs: number | null;
  /** 実行のページ（番号が無ければ null） */
  logUrl: string | null;
  /** 並べるための始まった時刻（ミリ秒。取れなければ null） */
  startedMs: number | null;
};

/** わざと止めた物（`ai:skip` に止めた理由の印がある。Paused の1行。Issue #520） */
export type PausedEntry = {
  key: string;
  owner: string;
  repo: string;
  number: number;
  title: string;
  url: string;
  /** 止めた理由（1行） */
  reason: string;
  /** 印のコメントの時刻（止めてからの時間の起点。ミリ秒。読めなければ null） */
  pausedAt: number | null;
};

export type LanesSource = {
  works: SlotWork[];
  queue: QueueSource[];
  runs: RunEntry[];
  /** Paused（止めてある物）。古い順 */
  paused: PausedEntry[];
};

const QUEUE_LABEL = "ai:queue";
const BLOCKED_LABEL = "ai:blocked";
const IMPLEMENT_LABEL = "ai:implement";
const PRIORITY_LABEL = "priority:high";
const HOLD_LABEL = "ai:hold";

/** 進捗ログの `step` → 進捗図の工程（`mocks` はデザイン） */
const LOG_STEP: Record<string, FlowStepKey> = {
  plan: "plan",
  mocks: "design",
  implement: "implement",
  ci: "ci",
  review: "review",
  fix: "fix",
  deploy: "deploy",
};

const MODEL_LABEL = { sonnet: "Sonnet", opus: "Opus", fable: "Fable" } as const;

/** 枠を使う作業か（パイプラインが並列に数える「実装中の Issue・open のPR」に近い物） */
export function occupiesSlot(status: IssueStatus): boolean {
  if (status.grace === "creatingPull") return true;
  switch (status.stage) {
    case "implementing":
    case "ciRunning":
    case "reviewing":
    case "fixing":
      return true;
    case "ciFailed":
      return ciFailureState({ stage: status.stage, stuck: false, fixCount: status.fixCount })?.kind === "fixing";
    default:
      return false;
  }
}

/** 枠の行の、今の工程の文 */
export function slotStepText(status: IssueStatus): string {
  if (status.grace === "creatingPull") return "PRを作っています";
  switch (status.stage) {
    case "implementing":
      return "実装しています";
    case "ciRunning":
      return status.verifyingFix ? "直した結果を確かめています" : "CIが確かめています";
    case "reviewing":
      return status.verifyingFix ? "直した結果を確かめています" : "レビューしています";
    default:
      return "直しています";
  }
}

/** その Issue の進捗ログで、今の工程のいちばん新しい行（開始時刻とモデル）。無ければ null */
function currentLogRow(data: RepoData, issueNumber: number, step: FlowStepKey, now: Date) {
  let found: { started: number; model: string | null } | null = null;
  for (const comment of data.comments) {
    if (comment.issueNumber !== issueNumber || !isStepLogComment(comment.body)) continue;
    for (const row of parseRunRows(comment.body, now)) {
      if (LOG_STEP[row.step] !== step) continue;
      if (found === null || row.started > found.started) found = { started: row.started, model: row.model };
    }
  }
  return found;
}

/** モデル名を画面の名前に（`claude-opus-5-5` → `Opus`）。知らない名前はそのまま */
export function modelLabel(model: string | null): string | null {
  if (model === null) return null;
  const known = usageModel(model);
  return known ? MODEL_LABEL[known] : model;
}

/** ワークフローの名前から、Running の種類（知らない物は名前のまま。名前が無ければ `Actions`） */
export function runKind(name: string | undefined): string {
  const text = name?.trim() ?? "";
  if (text === "") return "Actions";
  const lower = text.toLowerCase();
  if (lower === "claude implement") return "Implement";
  if (lower === "claude review") return "Review";
  if (lower === "claude plan") return "Plan";
  if (lower === "claude mention") return "Fix";
  if (lower === "claude mocks") return "Design";
  if (lower === "ci") return "CI";
  if (lower === "watchdog") return "Watchdog";
  if (lower === "sync to apps") return "Sync";
  if (lower === "queue") return "Queue";
  if (lower === "resume") return "Resume";
  if (lower === "visual update") return "Visual update";
  if (lower.startsWith("deploy")) return "Deploy";
  return text;
}

function timeOf(value: string | undefined | null): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

/** 順番待ちの並び：`ai:queue` で急ぎ → ほかの `ai:queue` → `ai:blocked`（`assignLamps` と同じ） */
function waitingRank(labels: string[]): number {
  if (!labels.includes(QUEUE_LABEL)) return 2;
  return labels.includes(PRIORITY_LABEL) ? 0 : 1;
}

/** 実行が、どの Issue・PR の物か（`isRelatedRun` と同じ手がかり：ブランチ・紐づくPR・題名の `#番号`） */
export function runTarget(
  run: WorkflowRunData,
  data: Pick<RepoData, "issues" | "pulls">,
): { issue: number | null; pull: number | null } {
  const branch = run.headBranch?.match(/^claude\/issue-(\d+)-/);
  let issue = branch ? Number(branch[1]) : null;
  let pull =
    data.pulls.find(
      (candidate) =>
        run.pullNumbers.includes(candidate.number) ||
        (candidate.headRef !== "" && candidate.headRef === run.headBranch),
    ) ?? null;
  if (issue === null && pull === null) {
    for (const match of run.displayTitle.matchAll(/#(\d+)(?!\d)/g)) {
      const n = Number(match[1]);
      if (data.issues.some((candidate) => candidate.number === n)) {
        issue = n;
        break;
      }
      const found = data.pulls.find((candidate) => candidate.number === n);
      if (found) {
        pull = found;
        break;
      }
    }
  }
  if (issue === null && pull !== null) {
    const linked = pull;
    issue = data.issues.find((candidate) => isLinkedPull(linked, candidate.number))?.number ?? null;
  }
  if (pull === null && issue !== null) pull = findLinkedPull(data.pulls, issue);
  return { issue, pull: pull?.number ?? null };
}

/** 1つのリポジトリの、いま動いている実行（同じ実行は1つにまとめる） */
function repoRuns(owner: string, repo: string, data: RepoData, now: Date): RunEntry[] {
  const seen = new Set<string>();
  const entries: RunEntry[] = [];
  const statuses = new Map(
    buildPipelineRows(data, now, `${owner}/${repo}`).map((row) => [row.issue.number, row.status]),
  );
  for (const run of data.runs ?? []) {
    if (run.status !== "in_progress") continue;
    const id = typeof run.id === "number" ? String(run.id) : `${run.headBranch}|${run.displayTitle}|${run.name ?? ""}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const target = runTarget(run, data);
    const activity = target.issue === null ? null : aiActivity(data, target.issue, owner, repo);
    const step = target.issue === null && typeof run.id === "number"
      ? (data.runSteps ?? []).find((candidate) => candidate.runId === run.id)?.name ?? null
      : null;
    const activityText =
      activity?.kind === "todo" ? activity.current : activity?.kind === "step" ? activity.name : step;
    const status = target.issue === null ? undefined : statuses.get(target.issue);
    let detail: string | null = null;
    if (status) {
      const flow = getFlow(status);
      const current = flow.steps[flow.at];
      const model = modelLabel(currentLogRow(data, target.issue!, current.key, now)?.model ?? null);
      detail = [current.name, model].filter((part): part is string => part !== null).join(" · ");
    }
    const startedMs = timeOf(run.startedAt);
    entries.push({
      key: `${owner}/${repo}@${id}`,
      kind: runKind(run.name),
      owner,
      repo,
      issueNumber: target.issue,
      pullNumber: target.pull,
      activity: activityText ?? (run.displayTitle.trim() === "" ? null : run.displayTitle.trim()),
      detail,
      elapsedMs: startedMs === null ? null : Math.max(0, now.getTime() - startedMs),
      logUrl: typeof run.id === "number" ? `https://github.com/${owner}/${repo}/actions/runs/${run.id}` : null,
      startedMs,
    });
  }
  return entries;
}

/** `ai:queue`・`ai:blocked` が最後に付いた時刻（ラベルの出来事から。無ければ null） */
function queuedAt(data: RepoData, issueNumber: number): number | null {
  let latest: number | null = null;
  for (const event of data.events) {
    if (event.event !== "labeled" || event.issueNumber !== issueNumber) continue;
    if (event.labelName !== QUEUE_LABEL && event.labelName !== BLOCKED_LABEL) continue;
    const at = timeOf(event.createdAt);
    if (at !== null && (latest === null || at > latest)) latest = at;
  }
  return latest;
}

function issueUrl(owner: string, repo: string, number: number): string {
  return `https://github.com/${owner}/${repo}/issues/${number}`;
}

/**
 * 結果から、枠を使っている作業・順番待ち・動いている実行をまとめる。
 * 並びは、リポジトリの並び（results の順）→ 番号。取れなかったリポジトリは飛ばす
 */
export function buildLanesSource(results: readonly RepoResult[], now: Date): LanesSource {
  const works: SlotWork[] = [];
  const queue: { entry: QueueSource; order: number; rank: number }[] = [];
  const runs: RunEntry[] = [];
  const paused: { entry: PausedEntry; order: number }[] = [];

  results.forEach((result, order) => {
    if (!result.ok) return;
    const { owner, repo, data } = result;
    const rows = buildPipelineRows(data, now, `${owner}/${repo}`);
    const issues = new Map(data.issues.map((issue) => [issue.number, issue]));

    const repoWorks: SlotWork[] = [];
    for (const row of [...rows].sort((a, b) => a.issue.number - b.issue.number)) {
      if (!occupiesSlot(row.status)) continue;
      // パイプラインが並列に数えるのは `ai:implement` の Issue だけ（人間が出した PR の Issue は席にしない）
      if (!(issues.get(row.issue.number)?.labels ?? []).includes(IMPLEMENT_LABEL)) continue;
      const flow = getFlow(row.status);
      const current = flow.steps[flow.at];
      const started = currentLogRow(data, row.issue.number, current.key, now)?.started ?? null;
      const pull = findLinkedPull(data.pulls, row.issue.number);
      repoWorks.push({
        key: `${owner}/${repo}#${row.issue.number}`,
        owner,
        repo,
        number: row.issue.number,
        title: row.issue.title,
        url: row.issue.url,
        stepText: slotStepText(row.status),
        stepAt: flow.at,
        stepName: FLOW_STEPS[flow.at].name,
        elapsedMs: started === null ? null : Math.max(0, now.getTime() - started),
        touches: pull?.files && pull.state === "open" ? pull.files : parseTouches(issues.get(row.issue.number)?.body ?? ""),
      });
    }
    works.push(...repoWorks);

    const holds = data.pulls
      .filter((pull) => pull.state === "open" && pull.labels.includes(HOLD_LABEL))
      .map((pull) => ({ pull, blocking: parseHoldBlocking(data.comments, pull.number) }));

    for (const row of rows) {
      if (row.status.stage !== "queued") continue;
      const issue = issues.get(row.issue.number);
      const labels = issue?.labels ?? [];
      const touches = parseTouches(issue?.body ?? "");
      let cause: QueueCause | null = null;
      let file: string | null = null;
      let waitFor: WaitFor | null = null;
      const hold = holds.find((candidate) => candidate.blocking.includes(row.issue.number));
      if (labels.includes(BLOCKED_LABEL)) {
        cause = "blocked";
        const after = queueAfterNumber(row.queueReason);
        if (after !== null) waitFor = { label: `#${after}`, url: issueUrl(owner, repo, after) };
      } else if (hold) {
        cause = "hold";
        file = touches && hold.pull.files ? touchesOverlap(touches, hold.pull.files) : null;
        waitFor = { label: `PR #${hold.pull.number}`, url: hold.pull.url };
      } else if (touches === null) {
        if (repoWorks.length > 0) cause = "noTouches";
      } else {
        const overlapping = repoWorks
          .map((work) => ({ work, file: work.touches ? touchesOverlap(touches, work.touches) : null }))
          .find((candidate) => candidate.file !== null);
        const unknown = repoWorks.find((work) => work.touches === null);
        if (overlapping) {
          cause = "overlap";
          file = overlapping.file;
          waitFor = { label: `#${overlapping.work.number}`, url: overlapping.work.url };
        } else if (unknown) {
          cause = "unknownInflight";
          waitFor = { label: `#${unknown.number}`, url: unknown.url };
        }
      }
      const at = queuedAt(data, row.issue.number);
      queue.push({
        entry: {
          key: `${owner}/${repo}#${row.issue.number}`,
          owner,
          repo,
          number: row.issue.number,
          title: row.issue.title,
          url: row.issue.url,
          cause,
          file,
          waitFor,
          waitingMs: at === null ? null : Math.max(0, now.getTime() - at),
        },
        order,
        rank: waitingRank(labels),
      });
    }

    for (const row of rows) {
      if (row.status.stage !== "skipped") continue;
      const issue = issues.get(row.issue.number);
      const mark = issue ? pausedMark(issue, data.comments, owner) : null;
      if (!mark) continue;
      paused.push({
        entry: {
          key: `${owner}/${repo}#${row.issue.number}`,
          owner,
          repo,
          number: row.issue.number,
          title: row.issue.title,
          url: row.issue.url,
          reason: mark.reason,
          pausedAt: timeOf(mark.at),
        },
        order,
      });
    }

    runs.push(...repoRuns(owner, repo, data, now));
  });

  return {
    paused: paused
      .sort(
        (a, b) =>
          a.order - b.order ||
          (a.entry.pausedAt ?? Number.MAX_SAFE_INTEGER) - (b.entry.pausedAt ?? Number.MAX_SAFE_INTEGER) ||
          a.entry.number - b.entry.number,
      )
      .map((item) => item.entry),
    works,
    queue: queue
      .sort((a, b) => a.order - b.order || a.rank - b.rank || a.entry.number - b.entry.number)
      .map((item) => item.entry),
    runs: runs.sort(
      (a, b) =>
        (a.startedMs ?? Number.MAX_SAFE_INTEGER) - (b.startedMs ?? Number.MAX_SAFE_INTEGER) ||
        a.key.localeCompare(b.key),
    ),
  };
}
