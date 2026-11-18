/** Dashboard の `30d`：専用に取った60日分の結果（`src/lib/github/extended.ts`）を、集計が読む `RepoData` に近い形へ変える純粋関数 */

import {
  convertGqlComments,
  convertGqlLabelEvents,
  type GqlIssue,
} from "../github/graphql";
import type { CommentData, IssueData, IssueEventData, PullData, RepoData } from "../github/types";
import { HUMAN_REQUEST_MARK } from "../humanRequest";
import { AUTO_FIX_MARK, RETRY_MARK, STUCK_PREFIX } from "../status";
import { STEP_LOG_MARKER } from "../stepLog";
import { EXTENDED_DAYS } from "./period";

const DAY_MS = 24 * 60 * 60 * 1000;

/** 専用の取得で使う Issue の項目（作成時刻・コメント・ラベルの出来事だけ） */
export type ExtendedIssueNode = Pick<GqlIssue, "number" | "createdAt" | "updatedAt" | "comments" | "timelineItems">;

/** 専用の取得で使う マージ済みPR の項目（番号・本文・ブランチ名・マージの時刻・コメント・ラベルの出来事だけ） */
export type ExtendedPullNode = Pick<GqlIssue, "number" | "createdAt" | "updatedAt" | "comments" | "timelineItems"> & {
  body?: string | null;
  headRefName: string;
  mergedAt?: string | null;
};

/** 集計に使う目印のコメントか（進捗ログ・止まった理由・自動の修正依頼・自動のやり直し）。ほかのコメントは残さない */
export function isKeptComment(body: string): boolean {
  return [STEP_LOG_MARKER, STUCK_PREFIX, HUMAN_REQUEST_MARK, AUTO_FIX_MARK, RETRY_MARK].some((mark) => body.includes(mark));
}

/** 集計に使うラベルの出来事か（`ai:stuck` の付け外し＝Stopped・Stops、`ai:queue` の付け外し＝Throughput の Queue） */
export function isKeptEvent(event: IssueEventData): boolean {
  return (
    (event.event === "labeled" || event.event === "unlabeled") &&
    (event.labelName === "ai:stuck" || event.labelName === "ai:queue")
  );
}

/** 「今」から60日前（これより前の物は数えない） */
export function extendedCutoff(now: Date): number {
  return now.getTime() - EXTENDED_DAYS * DAY_MS;
}

/**
 * 取った Issue・マージ済みPR を `RepoData` に近い形にする。
 * Issue：番号と作成時刻だけ（題名・本文・URLは持たない）。PR：マージの時刻が60日前より後の物だけ。
 * コメントは目印のある物だけ、ラベルの出来事は `ai:stuck`・`ai:queue` だけ。同じ番号は1件にする
 */
export function convertExtendedNodes(
  owner: string,
  issueNodes: readonly ExtendedIssueNode[],
  pullNodes: readonly ExtendedPullNode[],
  now: Date,
): RepoData {
  const cutoff = extendedCutoff(now);
  const issues: IssueData[] = [];
  const pulls: PullData[] = [];
  const comments: CommentData[] = [];
  const events: IssueEventData[] = [];
  const seenIssues = new Set<number>();
  const seenPulls = new Set<number>();

  const collect = (number: number, raw: Pick<GqlIssue, "comments" | "timelineItems">) => {
    comments.push(...convertGqlComments(number, raw).filter((comment) => isKeptComment(comment.body)));
    events.push(...convertGqlLabelEvents(number, raw).filter(isKeptEvent));
  };

  for (const raw of issueNodes) {
    if (seenIssues.has(raw.number)) continue;
    seenIssues.add(raw.number);
    issues.push({
      number: raw.number,
      title: "",
      body: "",
      state: "closed",
      labels: [],
      url: "",
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
      closedAt: null,
    });
    collect(raw.number, raw);
  }
  for (const raw of pullNodes) {
    const mergedAt = raw.mergedAt ?? null;
    if (seenPulls.has(raw.number)) continue;
    seenPulls.add(raw.number);
    // マージ済みで60日前より前の物は数えない。開いたまま・閉じた物は、止まった印（`ai:stuck`）などの出来事だけ残す
    if (mergedAt !== null && Date.parse(mergedAt) < cutoff) continue;
    if (mergedAt === null) {
      collect(raw.number, raw);
      continue;
    }
    pulls.push({
      number: raw.number,
      title: "",
      body: raw.body ?? "",
      state: "closed",
      merged: true,
      labels: [],
      url: "",
      headRef: raw.headRefName,
      headSha: "",
      mergeCommitSha: null,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
      mergedAt,
    });
    collect(raw.number, raw);
  }
  return {
    owner,
    issues,
    pulls,
    // 進捗ログは作ったあとも書き足されるので、作成が60日前より前でも残す（行の始まりの時刻で数える）
    comments: comments.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id - b.id),
    pullChecks: {},
    events: events.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  };
}
