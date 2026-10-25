import type { IssueData, PullData, RepoData, RepoResult } from "./github/types";
import {
  ciState,
  DEFAULT_STUCK_REASON,
  findLinkedPull,
  hasFinishedReviewCheck,
  isClaudeReviewCheck,
  isImplementDoneComment,
  isImplementErrorComment,
  LABEL,
  MAX_AUTO_FIX,
  shouldShowIssue,
  stuckReason,
} from "./status";

/** 出来事の種類（四角の背景とアイコンの色、docs/design.md の「最近の出来事」） */
export type EventTone = "human" | "ai" | "deployed" | "fail" | "operation";

/** 出来事のアイコンの形 */
export type EventIcon = "check" | "x" | "play" | "pr" | "eye" | "merge" | "up";

export type RecentEvent = {
  /** 画面のキーに使う、重ならない文字列 */
  id: string;
  /** 起きた時刻（ISO文字列） */
  at: string;
  tone: EventTone;
  icon: EventIcon;
  /** 出来事の文 */
  text: string;
  /** 下の段：`repo#番号・PR #番号` など */
  ref: string;
};

export const EVENT_WINDOW_DAYS = 3;
export const EVENT_LIMIT = 50;

const DAY_MS = 24 * 60 * 60 * 1000;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const STUCK_PREFIX = "⏸ 自動で進めるのを止めました：";
const AUTO_FIX_MARK = "<!-- auto-fix -->";
const NOT_FAILED_CONCLUSIONS = ["success", "skipped", "neutral"];

type Draft = Omit<RecentEvent, "id"> & { key: string };

function latest(times: (string | null)[]): string | null {
  const valid = times.filter((time): time is string => time !== null && time !== "");
  return valid.sort().at(-1) ?? null;
}

/** 1つのIssue（と紐づくPR）で起きた出来事 */
function issueEvents(repo: string, issue: IssueData, data: RepoData): Draft[] {
  const drafts: Draft[] = [];
  const pull: PullData | null = findLinkedPull(data.pulls, issue.number);
  const numbers = new Set([issue.number, ...(pull ? [pull.number] : [])]);
  const issueRef = `${repo}#${issue.number}`;
  const pullRef = pull ? `${issueRef}・PR #${pull.number}` : issueRef;
  const pullOnlyRef = pull ? `${repo}・PR #${pull.number}` : issueRef;
  const quoted = `「${issue.title}」`;

  const labeled = (name: string, target: number) =>
    data.events.filter(
      (event) => event.event === "labeled" && event.labelName === name && event.issueNumber === target,
    );

  for (const event of labeled(LABEL.implement, issue.number)) {
    drafts.push({
      key: `implement-${event.createdAt}`,
      at: event.createdAt,
      tone: "operation",
      icon: "play",
      text: `${quoted}の実装を依頼しました`,
      ref: issueRef,
    });
  }

  for (const comment of data.comments) {
    if (comment.issueNumber === issue.number) {
      if (isImplementDoneComment(comment)) {
        drafts.push({
          key: `done-${comment.id}`,
          at: comment.createdAt,
          tone: "human",
          icon: "check",
          text: "AIが実装を終えました。PRを作れます",
          ref: issueRef,
        });
      } else if (isImplementErrorComment(comment)) {
        drafts.push({
          key: `error-${comment.id}`,
          at: comment.createdAt,
          tone: "human",
          icon: "x",
          text: "AIがエラーで止まりました",
          ref: issueRef,
        });
      }
    }
    if (numbers.has(comment.issueNumber) && comment.body.includes(STUCK_PREFIX)) {
      const reason = stuckReason([comment], comment.issueNumber) ?? DEFAULT_STUCK_REASON;
      drafts.push({
        key: `stuck-${comment.id}`,
        at: comment.createdAt,
        tone: "human",
        icon: "x",
        text: `自動で進めるのを止めました：${reason}`,
        ref: pullRef,
      });
    }
  }

  if (!pull) return drafts;

  drafts.push({
    key: "pull",
    at: pull.createdAt,
    tone: "ai",
    icon: "pr",
    text: "PRができました",
    ref: pullRef,
  });

  // 自動の修正依頼（n/2 回目）
  const fixRequests = data.comments
    .filter((comment) => comment.issueNumber === pull.number && comment.body.includes(AUTO_FIX_MARK))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  fixRequests.forEach((comment, index) => {
    drafts.push({
      key: `fix-${comment.id}`,
      at: comment.createdAt,
      tone: "ai",
      icon: "pr",
      text: `AIに修正を依頼しました（${Math.min(index + 1, MAX_AUTO_FIX)}/${MAX_AUTO_FIX}）`,
      ref: pullRef,
    });
  });

  for (const event of labeled(LABEL.review, pull.number)) {
    drafts.push({
      key: `review-label-${event.createdAt}`,
      at: event.createdAt,
      tone: "operation",
      icon: "eye",
      text: "レビューを依頼しました",
      ref: pullOnlyRef,
    });
  }

  const checks = data.pullChecks[pull.number];
  if (checks) {
    const ci = ciState(checks.checkRuns);
    const ciRuns = checks.checkRuns.filter((check) => !isClaudeReviewCheck(check));
    if (ci.state === "passed") {
      const at = latest(ciRuns.map((check) => check.completedAt));
      if (at) {
        drafts.push({
          key: "ci-passed",
          at,
          tone: "ai",
          icon: "check",
          text: `CIが通りました（${ci.passed}/${ci.total}）`,
          ref: pullOnlyRef,
        });
      }
    } else if (ci.state === "failed") {
      const failed = ciRuns.filter(
        (check) =>
          check.status === "completed" &&
          check.conclusion !== null &&
          !NOT_FAILED_CONCLUSIONS.includes(check.conclusion),
      );
      const at = latest(failed.map((check) => check.completedAt));
      if (at) {
        drafts.push({
          key: "ci-failed",
          at,
          tone: "fail",
          icon: "x",
          text: `CIが失敗しました（${failed.map((check) => check.name).join("、")}）`,
          ref: pullOnlyRef,
        });
      }
    }

    if (hasFinishedReviewCheck(checks.checkRuns)) {
      const at = latest(
        checks.checkRuns
          .filter(
            (check) =>
              isClaudeReviewCheck(check) &&
              check.status === "completed" &&
              check.conclusion !== null &&
              check.conclusion !== "skipped",
          )
          .map((check) => check.completedAt),
      );
      if (at) {
        drafts.push({
          key: "review-done",
          at,
          tone: "ai",
          icon: "eye",
          text: "レビューAIが確認を終えました",
          ref: pullOnlyRef,
        });
      }
    }

    const deploy = checks.statuses
      .filter((status) => status.context.startsWith("Vercel"))
      .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
      .at(-1);
    if (deploy && pull.merged) {
      if (deploy.state === "success") {
        drafts.push({
          key: "deployed",
          at: deploy.updatedAt,
          tone: "deployed",
          icon: "up",
          text: `${quoted}が本番に公開されました`,
          ref: pullRef,
        });
      } else if (deploy.state === "failure" || deploy.state === "error") {
        drafts.push({
          key: "deploy-failed",
          at: deploy.updatedAt,
          tone: "fail",
          icon: "x",
          text: `${quoted}の公開に失敗しました`,
          ref: pullRef,
        });
      }
    }
  }

  if (pull.merged && pull.mergedAt) {
    // ai:hold が無いPRは、パイプラインが自動でマージしたもの
    const auto = !pull.labels.includes(LABEL.hold);
    drafts.push({
      key: "merged",
      at: pull.mergedAt,
      tone: auto ? "ai" : "operation",
      icon: "merge",
      text: auto ? `${quoted}を自動でマージしました` : `${quoted}をマージしました`,
      ref: pullRef,
    });
  }

  return drafts;
}

/** 1リポジトリぶんの出来事（期間で絞る前） */
export function repoEvents(owner: string, repo: string, data: RepoData): RecentEvent[] {
  const events: RecentEvent[] = [];
  for (const issue of data.issues) {
    if (!shouldShowIssue(issue, data.pulls)) continue;
    for (const { key, ...draft } of issueEvents(repo, issue, data)) {
      events.push({ id: `${owner}/${repo}#${issue.number}:${key}`, ...draft });
    }
  }
  return events;
}

/**
 * 全リポジトリの最近の出来事：直近3日、新しい順、最大50件。
 * 入力は画面に出すIssue・PRと同じ取得データ
 */
export function buildRecentEvents(results: RepoResult[], now: Date): RecentEvent[] {
  const since = now.getTime() - EVENT_WINDOW_DAYS * DAY_MS;
  return results
    .flatMap((result) => (result.ok ? repoEvents(result.owner, result.repo, result.data) : []))
    .filter((event) => {
      const time = Date.parse(event.at);
      return !Number.isNaN(time) && time >= since && time <= now.getTime();
    })
    .sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id))
    .slice(0, EVENT_LIMIT);
}

/** 日本時間の暦日（`2026-10-25`） */
function jstDate(time: number): string {
  return new Date(time + JST_OFFSET_MS).toISOString().slice(0, 10);
}

/** 日本時間の `16:57` */
export function formatEventTime(at: string): string {
  return new Date(Date.parse(at) + JST_OFFSET_MS).toISOString().slice(11, 16);
}

/** 日の見出し：「今日」「昨日」、それより前は `10月23日`（日本時間） */
export function dayHeading(at: string, now: Date): string {
  const day = jstDate(Date.parse(at));
  if (day === jstDate(now.getTime())) return "今日";
  if (day === jstDate(now.getTime() - DAY_MS)) return "昨日";
  const [, month, date] = day.split("-");
  return `${Number(month)}月${Number(date)}日`;
}

export type EventDay = { heading: string; events: RecentEvent[] };

/** 新しい順の出来事を、日ごとにまとめる */
export function groupEventsByDay(events: RecentEvent[], now: Date): EventDay[] {
  const days: EventDay[] = [];
  for (const event of events) {
    const heading = dayHeading(event.at, now);
    const last = days.at(-1);
    if (last && last.heading === heading) last.events.push(event);
    else days.push({ heading, events: [event] });
  }
  return days;
}
