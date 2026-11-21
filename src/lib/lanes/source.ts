import { aiActivity, factoryRunsByIssue } from "../aiActivity";
import { ciProgress, type CiProgress } from "../ciProgress";
import { ciFailureState } from "../ciFailureState";
import { factoryStage } from "../factoryStage";
import { queueAfterNumber } from "../conversation";
import { blockedByLabel, openBlockedBy, parseBlockedBy } from "../queueReason";
import { usageModel } from "../dashboard/aiUsage";
import { parseRunRows, summarize } from "../dashboard/summary";
import { FLOW_STEPS, getFlow, type FlowStepKey } from "../flow";
import type { IssueData, RepoData, RepoResult, WorkflowRunData } from "../github/types";
import { parseHoldBlocking } from "../holdBlocking";
import { pausedMark } from "../paused";
import { buildPipelineRows } from "../pipeline";
import { findLinkedPull, isLinkedPull, type IssueStatus } from "../status";
import { isStepLogComment } from "../stepLog";
import { backgroundTitle } from "./backgroundTitle";
import { isSleepingRun, wakeAtFromTitle } from "./sleeping";
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
  /** CI の段（`ciRunning`）にいる間だけ、CI のチェックの進み具合（`IssueStatus.ci` から）。ほかは null */
  ci: CiProgress | null;
  /** 触るファイル（PRがあれば変更ファイル、無ければ Issue の印）。分からなければ null */
  touches: string[] | null;
};

/** 待つ理由のうち、枠の数に関係なく決まる物 */
export type QueueCause = "blocked" | "hold" | "noTouches" | "overlap" | "unknownInflight";

/** 待つ相手（Issue か PR） */
export type WaitFor = { label: string; url: string };

/** 待つ相手の作業（Issue か PR）。2行目の `待ち：…` の材料 */
export type WaitTarget = {
  kind: "issue" | "pull";
  number: number;
  title: string;
  /** Slots で席を使って動いている作業か */
  running: boolean;
  /** 進捗図を開く Issue の番号（PR で Issue が分からなければ null） */
  issueNumber: number | null;
  /** GitHub のページ */
  url: string;
  /** 別のリポジトリの相手のときだけ、そのリポジトリ名（`リポジトリ#番号` で出す） */
  otherRepo?: { owner: string; repo: string };
};

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
  /** 待つ相手の一覧（重なる作業すべて。分からなければ空） */
  waitFors: WaitTarget[];
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
  /** 寝ているだけの実行か（目覚まし。`isSleepingRun`。Background の Sleeping に出す。Issue #584） */
  sleeping: boolean;
  /** 寝ている実行の起きる時刻（ミリ秒。題名の unix 時刻から。読めない・寝ていない実行は null） */
  wakeAtMs: number | null;
  /** 動いているジョブの数（`RepoData.runJobs` から。寝ている実行・読めなかった実行は null） */
  jobs: number | null;
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
    case "mergeWaiting":
      // CI が通ってレビュー・自動マージを待つ物。`ai:hold`（人間のマージ待ち）は数えない
      return status.mergeWait === "needsReview" || status.mergeWait === "autoMerge";
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
    case "mergeWaiting":
      return status.mergeWait === "autoMerge" ? "まもなく自動でマージします" : "CIが通りました。レビュー待ちです";
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
  const jobCounts = new Map((data.runJobs ?? []).map((entry) => [entry.runId, entry.inProgress]));
  // 工場の実行は Issue 番号で結びつかないので、開いている `新サービス：` の Issue ごとの、動いている工場の実行で結びつける（Issue #692）。
  // 結びつけるのは段が `作業中`・`本番を作っている`（`factoryStage`）の Issue だけ。相談待ち（`factory:wait`）の Issue には結びつけない
  const factoryIssueByRun = new Map<number, IssueData>();
  for (const [number, run] of [...factoryRunsByIssue(data)].sort((a, b) => a[0] - b[0])) {
    const issue = data.issues.find((candidate) => candidate.number === number);
    if (!issue || run.id === undefined || factoryIssueByRun.has(run.id)) continue;
    const phase = factoryStage({ labels: issue.labels, state: issue.state, runs: data.runs, runSteps: data.runSteps });
    if (phase.kind !== "working" && phase.kind !== "building") continue;
    factoryIssueByRun.set(run.id, issue);
  }
  for (const run of data.runs ?? []) {
    if (run.status !== "in_progress") continue;
    const id = typeof run.id === "number" ? String(run.id) : `${run.headBranch}|${run.displayTitle}|${run.name ?? ""}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const sleeping = isSleepingRun(run);
    // 寝ている実行は Issue の番号の手がかりを持たない物として扱う（席にぶら下げない）
    const target = sleeping ? { issue: null, pull: null } : runTarget(run, data);
    const factoryIssue =
      target.issue === null && target.pull === null && !sleeping && run.id !== undefined
        ? factoryIssueByRun.get(run.id) ?? null
        : null;
    if (factoryIssue) target.issue = factoryIssue.number;
    const activity = target.issue === null || factoryIssue ? null : aiActivity(data, target.issue, owner, repo);
    const step = target.issue === null && typeof run.id === "number"
      ? (data.runSteps ?? []).find((candidate) => candidate.runId === run.id)?.name ?? null
      : null;
    const activityText =
      activity?.kind === "todo" ? activity.current : activity?.kind === "step" ? activity.name : step;
    const status = target.issue === null || factoryIssue ? undefined : statuses.get(target.issue);
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
      // 工場の行は、真ん中に Issue の題名（実行の題名は `Factory talk` だけで、どの作業か分からない）
      activity: factoryIssue?.title ?? activityText ?? backgroundTitle(run.displayTitle, data.pulls),
      detail,
      elapsedMs: startedMs === null ? null : Math.max(0, now.getTime() - startedMs),
      logUrl: typeof run.id === "number" ? `https://github.com/${owner}/${repo}/actions/runs/${run.id}` : null,
      startedMs,
      sleeping,
      wakeAtMs: sleeping ? wakeAtFromTitle(run.displayTitle) : null,
      jobs: sleeping ? null : (jobCounts.get(run.id ?? -1) ?? null),
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
/** ホームの上端の帯の右の1行の数：実装中（枠を使っている作業）と順番待ち（Slots & Queue と同じ数え方） */
export type HomeActivity = {
  running: number;
  queued: number;
  /** 直近24時間に公開（マージ）された数（Dashboard の `24h` の `Merged` と同じ） */
  published: number;
  /** 実装中の作業（待ちが0件の画面に1件ずつ出す。工程の名前つき） */
  works: { key: string; repo: string; number: number; title: string; stepName: string }[];
};

export function activityOf(results: readonly RepoResult[], now: Date): HomeActivity {
  const source = buildLanesSource(results, now);
  return {
    running: source.works.length,
    queued: source.queue.length,
    published: summarize(results, now, "24h").merged ?? 0,
    works: source.works.map(({ key, repo, number, title, stepName }) => ({ key, repo, number, title, stepName })),
  };
}

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
        ci: row.status.stage === "ciRunning" ? ciProgress(row.status.ci) : null,
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
      let waitFors: WaitTarget[] = [];
      const workTarget = (work: SlotWork): WaitTarget => ({
        kind: "issue",
        number: work.number,
        title: work.title,
        running: true,
        issueNumber: work.number,
        url: work.url,
      });
      const hold = holds.find((candidate) => candidate.blocking.includes(row.issue.number));
      if (labels.includes(BLOCKED_LABEL)) {
        cause = "blocked";
        // 相手は、まず `blocked-by` の印（まだ開いている物だけ）から。印が無いときだけ理由の文から
        const marks = openBlockedBy(parseBlockedBy(data.comments, row.issue.number), { owner, repo }, data);
        const after = queueAfterNumber(row.queueReason);
        if (marks.length > 0) {
          const targets: WaitTarget[] = marks.map((mark) => {
            const here = blockedByLabel(mark, { owner, repo }) === `#${mark.number}`;
            const url = issueUrl(mark.owner, mark.repo, mark.number);
            return {
              kind: "issue",
              number: mark.number,
              title: here ? (issues.get(mark.number)?.title ?? "") : "",
              running: here && repoWorks.some((work) => work.number === mark.number),
              issueNumber: here ? mark.number : null,
              url,
              ...(here ? {} : { otherRepo: { owner: mark.owner, repo: mark.repo } }),
            };
          });
          waitFor = { label: blockedByLabel(marks[0], { owner, repo }), url: targets[0].url };
          waitFors = targets;
        } else if (after !== null) {
          waitFor = { label: `#${after}`, url: issueUrl(owner, repo, after) };
          waitFors = [
            {
              kind: "issue",
              number: after,
              title: issues.get(after)?.title ?? "",
              running: repoWorks.some((work) => work.number === after),
              issueNumber: after,
              url: issueUrl(owner, repo, after),
            },
          ];
        }
      } else if (hold) {
        cause = "hold";
        file = touches && hold.pull.files ? touchesOverlap(touches, hold.pull.files) : null;
        waitFor = { label: `PR #${hold.pull.number}`, url: hold.pull.url };
        waitFors = holds
          .filter((candidate) => candidate.blocking.includes(row.issue.number))
          .map(({ pull }) => ({
            kind: "pull" as const,
            number: pull.number,
            title: pull.title,
            running: false,
            issueNumber: data.issues.find((candidate) => isLinkedPull(pull, candidate.number))?.number ?? null,
            url: pull.url,
          }));
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
          waitFors = repoWorks
            .filter((work) => work.touches !== null && touchesOverlap(touches, work.touches) !== null)
            .map(workTarget);
        } else if (unknown) {
          cause = "unknownInflight";
          waitFor = { label: `#${unknown.number}`, url: unknown.url };
          waitFors = repoWorks.filter((work) => work.touches === null).map(workTarget);
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
          waitFors,
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
