import { describeStatus, failureLogUrl, PIPELINE_MISSING_TEXT } from "./describe";
import { isDeployStatus } from "./deployStatus";
import type { IssueData, RepoData, RepoResult } from "./github/types";
import {
  getIssueStatus,
  isClaudeReviewCheck,
  isImplementDoneComment,
  isImplementErrorComment,
  LABEL,
  reviewOutcome,
  shouldShowIssue,
  type IssueStatus,
} from "./status";

/** 「あなたの番」で押せる操作（サーバー側で実行する物） */
export type OperationKind = "plan" | "implement" | "resume" | "start" | "createPull" | "requestReview" | "merge";

export const OPERATION_KINDS: readonly OperationKind[] = [
  "plan",
  "implement",
  "resume",
  "start",
  "createPull",
  "requestReview",
  "merge",
];

/** ボタンの文字（docs/spec.md の「操作」、docs/design.md の「あなたの番」） */
export const OPERATION_LABEL: Record<OperationKind, string> = {
  plan: "おまかせ",
  implement: "実装を依頼",
  resume: "再開",
  start: "始める",
  createPull: "PRを作る",
  requestReview: "レビューを依頼",
  merge: "マージ…",
};

/** 1つのボタン：サーバーの操作か、GitHubで開くリンク（公開失敗の「確認する」） */
export type TurnButton =
  | { type: "operation"; kind: OperationKind; label: string }
  | { type: "link"; label: string; href: string };

/** PRを作る・マージするときの向き先（docs/spec.md の「操作」） */
export const PULL_BASE = "main";

/** マージの確認ダイアログに出す中身 */
export type MergeSummary = {
  pullNumber: number;
  base: string;
  ci: { passed: number; total: number };
  review: "clean" | "issues" | null;
};

export type TurnItem = {
  owner: string;
  repo: string;
  issue: { number: number; title: string; url: string };
  status: IssueStatus;
  description: string;
  /** 止まった理由のログのURL（この行のリポジトリの実行のページ。無ければ null） */
  logUrl: string | null;
  /** 人間の番になった時刻（ISO文字列） */
  waitingSince: string;
  buttons: TurnButton[];
  /** マージのボタンを出すときだけ */
  merge: MergeSummary | null;
};

/** 1件のキー（`owner/repo#番号`。流れの光のキーと同じ） */
export function turnItemKey(item: Pick<TurnItem, "owner" | "repo" | "issue">): string {
  return `${item.owner}/${item.repo}#${item.issue.number}`;
}

function operation(kind: OperationKind): TurnButton {
  return { type: "operation", kind, label: OPERATION_LABEL[kind] };
}

/** マージ待ちで `ai:hold` があり、まだレビューしていない */
function needsReviewRequest(status: IssueStatus, data: Pick<RepoData, "comments">): boolean {
  return (
    status.stage === "mergeWaiting" &&
    status.mergeWait === "hold" &&
    status.pull !== null &&
    reviewOutcome(data.comments, status.pull.number) === null
  );
}

/** 段階から、出すボタンを決める */
export function turnButtons(
  status: IssueStatus,
  data: Pick<RepoData, "comments" | "pipeline">,
): TurnButton[] {
  switch (status.stage) {
    case "stuck":
      return [operation("resume")];
    case "skipped":
      return [operation("start")];
    case "notStarted":
      // パイプラインが動いていないと、頼んでも誰も動かないのでボタンを出さない
      return data.pipeline === "notConfigured" ? [] : [operation("plan"), operation("implement")];
    case "prWaiting":
      return [operation("createPull")];
    case "mergeWaiting":
      if (status.mergeWait !== "hold") return [];
      return needsReviewRequest(status, data)
        ? [operation("requestReview"), operation("merge")]
        : [operation("merge")];
    case "deployFailed":
      return status.pull ? [{ type: "link", label: "確認する", href: status.pull.url }] : [];
    default:
      return [];
  }
}

/** 今の段階で、その操作を受け付けるか（サーバー側で取り直した状態で確かめる） */
export function isOperationAvailable(
  kind: OperationKind,
  status: IssueStatus,
  data: Pick<RepoData, "comments" | "pipeline">,
): boolean {
  return turnButtons(status, data).some(
    (button) => button.type === "operation" && button.kind === kind,
  );
}

function latest(times: (string | null | undefined)[]): string | null {
  const valid = times.filter((time): time is string => typeof time === "string" && time !== "");
  return valid.sort().at(-1) ?? null;
}

/** 人間の番になった時刻（待ち時間の起点） */
export function waitingSince(issue: IssueData, status: IssueStatus, data: RepoData): string {
  const pull = status.pull;
  const numbers = new Set([issue.number, ...(pull ? [pull.number] : [])]);
  const checks = pull ? data.pullChecks[pull.number] : undefined;
  let since: string | null = null;
  switch (status.stage) {
    case "stuck":
      since = latest(
        data.events
          .filter(
            (event) =>
              event.event === "labeled" &&
              event.labelName === LABEL.stuck &&
              event.issueNumber !== null &&
              numbers.has(event.issueNumber),
          )
          .map((event) => event.createdAt),
      );
      break;
    case "skipped":
      since = latest(
        data.events
          .filter(
            (event) =>
              event.event === "labeled" &&
              event.labelName === LABEL.skip &&
              event.issueNumber === issue.number,
          )
          .map((event) => event.createdAt),
      );
      since ??= issue.createdAt;
      break;
    case "notStarted":
      since = issue.createdAt;
      break;
    case "prWaiting":
      since = latest(
        data.comments
          .filter(
            (comment) =>
              comment.issueNumber === issue.number &&
              (isImplementDoneComment(comment) || isImplementErrorComment(comment)),
          )
          .map((comment) => comment.createdAt),
      );
      break;
    case "mergeWaiting":
      since = latest(
        (checks?.checkRuns ?? [])
          .filter((check) => !isClaudeReviewCheck(check))
          .map((check) => check.completedAt),
      );
      since ??= pull?.createdAt ?? null;
      break;
    case "deployFailed":
      since = latest(
        (checks?.statuses ?? [])
          .filter((s) => isDeployStatus(s.context))
          .map((s) => s.updatedAt),
      );
      since ??= pull?.mergedAt ?? null;
      break;
  }
  return since ?? (pull ? latest([issue.updatedAt, pull.updatedAt]) : null) ?? issue.updatedAt;
}

/** 止まった物がいちばん上、あとは待ちが長い（人間の番になったのが古い）順 */
export function compareTurnItems(a: TurnItem, b: TurnItem): number {
  const stuckA = a.status.stage === "stuck" ? 0 : 1;
  const stuckB = b.status.stage === "stuck" ? 0 : 1;
  if (stuckA !== stuckB) return stuckA - stuckB;
  const byTime = a.waitingSince.localeCompare(b.waitingSince);
  if (byTime !== 0) return byTime;
  const byRepo = `${a.owner}/${a.repo}`.localeCompare(`${b.owner}/${b.repo}`);
  if (byRepo !== 0) return byRepo;
  return a.issue.number - b.issue.number;
}

/** 1リポジトリぶんの「あなたの番」（並べる前） */
export function repoTurnItems(owner: string, repo: string, data: RepoData, now: Date): TurnItem[] {
  const items: TurnItem[] = [];
  for (const issue of data.issues) {
    if (!shouldShowIssue(issue, data.pulls)) continue;
    const status = getIssueStatus(issue, data, now);
    if (status.turn !== "human") continue;
    const buttons = turnButtons(status, data);
    const canMerge = buttons.some((b) => b.type === "operation" && b.kind === "merge");
    items.push({
      owner,
      repo,
      issue: { number: issue.number, title: issue.title, url: issue.url },
      status,
      description:
        status.stage === "notStarted" && data.pipeline === "notConfigured"
          ? PIPELINE_MISSING_TEXT
          : describeStatus(status, { repo: `${owner}/${repo}` }).long,
      logUrl: failureLogUrl(status, `${owner}/${repo}`),
      waitingSince: waitingSince(issue, status, data),
      buttons,
      merge:
        canMerge && status.pull
          ? {
              pullNumber: status.pull.number,
              base: PULL_BASE,
              ci: status.ci,
              review: reviewOutcome(data.comments, status.pull.number),
            }
          : null,
    });
  }
  return items;
}

/** 取得できたリポジトリ全部の「あなたの番」を、並び順どおりに返す */
export function buildTurnItems(results: RepoResult[], now: Date): TurnItem[] {
  return results
    .flatMap((result) => (result.ok ? repoTurnItems(result.owner, result.repo, result.data, now) : []))
    .sort(compareTurnItems);
}

/** リポジトリの「あなたの番」だけ（大文字小文字は区別しない） */
export function filterTurnItems(items: TurnItem[], owner: string, repo: string): TurnItem[] {
  const key = `${owner}/${repo}`.toLowerCase();
  return items.filter((item) => `${item.owner}/${item.repo}`.toLowerCase() === key);
}

export type TurnCounts = {
  total: number;
  /** `owner/repo`（小文字）→ 件数 */
  byRepo: Record<string, number>;
};

/** サイドバーに出す件数 */
export function countTurnItems(items: TurnItem[]): TurnCounts {
  const byRepo: Record<string, number> = {};
  for (const item of items) {
    const key = `${item.owner}/${item.repo}`.toLowerCase();
    byRepo[key] = (byRepo[key] ?? 0) + 1;
  }
  return { total: items.length, byRepo };
}

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** 待ち時間の表示（`5分` `3時間` `2日`） */
export function formatWait(since: string, now: Date): string {
  const elapsed = Math.max(0, now.getTime() - Date.parse(since));
  if (Number.isNaN(elapsed)) return "";
  if (elapsed < HOUR_MS) return `${Math.max(1, Math.floor(elapsed / MINUTE_MS))}分`;
  if (elapsed < DAY_MS) return `${Math.floor(elapsed / HOUR_MS)}時間`;
  return `${Math.floor(elapsed / DAY_MS)}日`;
}
