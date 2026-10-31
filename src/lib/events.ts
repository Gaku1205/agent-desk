import { isFailedState, latestCountedPerContext } from "./deployStatus";
import type { CommitStatusData, IssueData, PullData, RepoData, RepoResult } from "./github/types";
import {
  ciState,
  DEFAULT_STUCK_REASON,
  findLinkedPull,
  getIssueStatus,
  hasFinishedReviewCheck,
  isClaudeReviewCheck,
  isImplementDoneComment,
  isImplementErrorComment,
  LABEL,
  MAX_AUTO_FIX,
  shouldShowIssue,
  stuckReason,
  type Stage,
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

type Draft = Omit<RecentEvent, "id"> & { key: string; short: string };

function latest(times: (string | null)[]): string | null {
  const valid = times.filter((time): time is string => time !== null && time !== "");
  return valid.sort().at(-1) ?? null;
}

/** 出来事に出す公開の足あと：成功か失敗と、その時刻 */
export type DeployFootprint = { result: "success" | "failure"; at: string };

/** `time` が `base` より後か（どちらか無い・読めないときは false） */
function isLater(time: string | undefined | null, base: string | null): boolean {
  if (!time || !base) return false;
  const t = Date.parse(time);
  const b = Date.parse(base);
  return !Number.isNaN(t) && !Number.isNaN(b) && t > b;
}

/**
 * マージ済みPRの出来事に出す公開の足あと。段階の判定（`deployState`）と同じ考えで、あとの公開も見る。
 * - マージコミットの公開が failure・error でも、同じ context で、マージより後に main の公開が成功していれば、
 *   失敗は出さず、その成功の時刻で成功にする
 * - マージコミットに公開の状態が無くても（飛ばした物の success だけのときも同じ扱い）、マージより後に main の公開が成功していれば、
 *   そのうち最新の時刻で成功にする（context は問わない）
 * - あとの公開が無い・まだ失敗のままなら失敗。途中（pending）のままなら null（何も出さない）
 * `mainDeployed` が文字列のときは、どの context にも同じ時刻を使う
 */
export function deployFootprint(
  statuses: CommitStatusData[],
  mergedAt: string | null,
  mainDeployed: Record<string, string> | string | null = null,
): DeployFootprint | null {
  const laterSuccess = (context: string): string | null => {
    const at = typeof mainDeployed === "string" ? mainDeployed : (mainDeployed?.[context] ?? null);
    return isLater(at, mergedAt) ? at : null;
  };
  const sorted = latestCountedPerContext(statuses).sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));

  if (sorted.length === 0) {
    const times =
      typeof mainDeployed === "string" ? [mainDeployed] : Object.values(mainDeployed ?? {});
    const at = latest(times.filter((time) => isLater(time, mergedAt)));
    return at ? { result: "success", at } : null;
  }

  const unresolved = sorted.filter((s) => isFailedState(s.state) && laterSuccess(s.context) === null);
  const lastUnresolved = unresolved.at(-1);
  if (lastUnresolved) return { result: "failure", at: lastUnresolved.updatedAt };
  if (sorted.some((s) => s.state !== "success" && !isFailedState(s.state))) return null;

  const at = latest(sorted.map((s) => (isFailedState(s.state) ? laterSuccess(s.context) : s.updatedAt)));
  return at ? { result: "success", at } : null;
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
      short: "実装を依頼",
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
          short: "実装が終わった · PRを作れます",
          ref: issueRef,
        });
      } else if (isImplementErrorComment(comment)) {
        drafts.push({
          key: `error-${comment.id}`,
          at: comment.createdAt,
          tone: "human",
          icon: "x",
          text: "AIがエラーで止まりました",
          short: "AIがエラーで停止",
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
        short: "止まった",
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
    short: "PRができた",
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
      short: `修正を依頼 ${Math.min(index + 1, MAX_AUTO_FIX)}/${MAX_AUTO_FIX}`,
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
      short: "レビュー依頼",
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
          short: `CI ${ci.passed}/${ci.total}`,
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
          short: `CI失敗（${failed.map((check) => check.name).join("、")}）`,
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
          short: "レビュー済",
          ref: pullOnlyRef,
        });
      }
    }

  }

  if (pull.merged) {
    const deploy = deployFootprint(
      checks?.statuses ?? [],
      pull.mergedAt,
      data.mainDeployedByContext ?? data.mainDeployedAt ?? null,
    );
    if (deploy?.result === "success") {
      drafts.push({
        key: "deployed",
        at: deploy.at,
        tone: "deployed",
        icon: "up",
        text: `${quoted}が本番に公開されました`,
        short: "本番に公開",
        ref: pullRef,
      });
    } else if (deploy?.result === "failure") {
      drafts.push({
        key: "deploy-failed",
        at: deploy.at,
        tone: "fail",
        icon: "x",
        text: `${quoted}の公開に失敗しました`,
        short: "公開に失敗",
        ref: pullRef,
      });
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
      short: auto ? "自動でマージ" : "マージ",
      ref: pullRef,
    });
  }

  return drafts;
}

/** 出来事が起きた Issue（Issue ごとにまとめるときの見出し） */
export type EventIssue = {
  owner: string;
  repo: string;
  number: number;
  title: string;
  url: string;
  /** 今の段階（公開済みの Issue を隠すのに使う） */
  stage: Stage;
};

/** Issue ごとにまとめた出来事の1つ（足あと）。`short` は1語の短い文言（docs/design.md の「出来事」） */
export type TrailEvent = RecentEvent & { short: string; issue: EventIssue };

/** 1リポジトリぶんの出来事（期間で絞る前）。Issue と短い文言つき */
export function repoTrailEvents(owner: string, repo: string, data: RepoData, now: Date): TrailEvent[] {
  const events: TrailEvent[] = [];
  for (const issue of data.issues) {
    if (!shouldShowIssue(issue, data.pulls)) continue;
    const stage = getIssueStatus(issue, data, now).stage;
    const issueRef: EventIssue = { owner, repo, number: issue.number, title: issue.title, url: issue.url, stage };
    for (const { key, ...draft } of issueEvents(repo, issue, data)) {
      events.push({ id: `${owner}/${repo}#${issue.number}:${key}`, ...draft, issue: issueRef });
    }
  }
  return events;
}

/** 1リポジトリぶんの出来事（期間で絞る前） */
export function repoEvents(owner: string, repo: string, data: RepoData, now: Date): RecentEvent[] {
  return repoTrailEvents(owner, repo, data, now).map(({ id, at, tone, icon, text, ref }) => ({ id, at, tone, icon, text, ref }));
}

/** 直近3日に入る出来事か */
function inWindow(at: string, now: Date): boolean {
  const time = Date.parse(at);
  return !Number.isNaN(time) && time >= now.getTime() - EVENT_WINDOW_DAYS * DAY_MS && time <= now.getTime();
}

/**
 * 全リポジトリ（または1つ）の最近の出来事を、Issue と短い文言つきで返す（直近3日、新しい順、最大50件）。
 * `buildRecentEvents` と同じ物を選ぶ
 */
export function buildTrailEvents(
  results: RepoResult[],
  now: Date,
  filter?: { owner: string; repo: string },
): TrailEvent[] {
  return results
    .flatMap((result) => {
      if (!result.ok) return [];
      if (
        filter &&
        (result.owner.toLowerCase() !== filter.owner.toLowerCase() ||
          result.repo.toLowerCase() !== filter.repo.toLowerCase())
      ) {
        return [];
      }
      return repoTrailEvents(result.owner, result.repo, result.data, now);
    })
    .filter((event) => inWindow(event.at, now))
    .sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id))
    .slice(0, EVENT_LIMIT);
}

/**
 * 全リポジトリの最近の出来事：直近3日、新しい順、最大50件。
 * 入力は画面に出すIssue・PRと同じ取得データ
 */
export function buildRecentEvents(results: RepoResult[], now: Date): RecentEvent[] {
  const since = now.getTime() - EVENT_WINDOW_DAYS * DAY_MS;
  return results
    .flatMap((result) => (result.ok ? repoEvents(result.owner, result.repo, result.data, now) : []))
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
