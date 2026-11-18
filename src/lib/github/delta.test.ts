import { describe, expect, it } from "vitest";
import {
  DELTA_OVERLAP_MS,
  FULL_READ_INTERVAL_MS,
  mergeRepoParts,
  planRepoRead,
  RECENT_REREAD_MS,
  shouldReadFullAfterDeltaError,
  shouldReadMorePulls,
} from "./delta";
import type { RepoParts } from "./graphql";
import type { CommentData, IssueData, PullData, RepoSyncInfo } from "./types";

const NOW = Date.parse("2026-10-25T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const CUTOFF = NOW - 14 * DAY;
const at = (ms: number) => new Date(ms).toISOString();

function sync(readAgoMs: number, fullAgoMs: number = readAgoMs): RepoSyncInfo {
  return { mode: "delta", readAt: at(NOW - readAgoMs), fullAt: at(NOW - fullAgoMs), count: 0 };
}

describe("planRepoRead（差分か全部か）", () => {
  it("前の結果が無ければ全部", () => {
    expect(planRepoRead(undefined, NOW, CUTOFF)).toEqual({ mode: "full" });
    expect(planRepoRead(null, NOW, CUTOFF)).toEqual({ mode: "full" });
  });

  it("前に読んでから10分：1時間前より後に更新された物を差分で読む", () => {
    expect(planRepoRead(sync(10 * 60_000), NOW, CUTOFF)).toEqual({ mode: "delta", sinceMs: NOW - RECENT_REREAD_MS });
  });

  it("前に読んでから2時間：前に読んだ時刻の2分前から読む", () => {
    const readAgo = 2 * 60 * 60_000;
    expect(planRepoRead(sync(readAgo), NOW, CUTOFF)).toEqual({ mode: "delta", sinceMs: NOW - readAgo - DELTA_OVERLAP_MS });
  });

  it("最後に全部を読んでから6時間たったら全部（6時間に1回）", () => {
    expect(planRepoRead(sync(60_000, FULL_READ_INTERVAL_MS - 1), NOW, CUTOFF).mode).toBe("delta");
    expect(planRepoRead(sync(60_000, FULL_READ_INTERVAL_MS), NOW, CUTOFF)).toEqual({ mode: "full" });
  });

  it("時刻が読めない・未来・全部を読んだ時刻が読んだ時刻より後なら全部", () => {
    expect(planRepoRead({ ...sync(60_000), readAt: "x" }, NOW, CUTOFF)).toEqual({ mode: "full" });
    expect(planRepoRead(sync(-60_000, 0), NOW, CUTOFF)).toEqual({ mode: "full" });
    expect(planRepoRead(sync(60 * 60_000, 30 * 60_000), NOW, CUTOFF)).toEqual({ mode: "full" });
  });

  it("さかのぼる時刻が直近14日の境目より前なら全部", () => {
    expect(planRepoRead(sync(60_000), NOW, NOW - 30 * 60_000)).toEqual({ mode: "full" });
  });
});

describe("shouldReadFullAfterDeltaError（差分の読みが失敗したとき）", () => {
  it("通信や返事の失敗は、その回のうちに全部を読み直す", () => {
    expect(shouldReadFullAfterDeltaError(null)).toBe(true);
    expect(shouldReadFullAfterDeltaError("other")).toBe(true);
  });

  it("回数制限・権限なし・見つからないは読み直さない（全部を読んでも同じ）", () => {
    for (const kind of ["rate_limited", "forbidden", "not_found", "unauthorized"] as const) {
      expect(shouldReadFullAfterDeltaError(kind)).toBe(false);
    }
  });
});

describe("shouldReadMorePulls（PR の続きを読むか）", () => {
  it("そのページのいちばん古い物が境目より前なら止める", () => {
    expect(shouldReadMorePulls(at(NOW - 1000), NOW - 2000)).toBe(true);
    expect(shouldReadMorePulls(at(NOW - 2000), NOW - 2000)).toBe(true);
    expect(shouldReadMorePulls(at(NOW - 3000), NOW - 2000)).toBe(false);
    expect(shouldReadMorePulls(undefined, NOW - 2000)).toBe(false);
  });
});

function issue(number: number, updatedAgoMs: number, options: Partial<IssueData> = {}): IssueData {
  return {
    number,
    title: `issue ${number}`,
    body: "",
    state: "open",
    labels: [],
    url: `https://github.com/o/r/issues/${number}`,
    createdAt: at(NOW - 20 * DAY),
    updatedAt: at(NOW - updatedAgoMs),
    closedAt: null,
    ...options,
  };
}

function pull(number: number, updatedAgoMs: number, options: Partial<PullData> = {}): PullData {
  return {
    number,
    title: `PR ${number}`,
    body: "",
    state: "open",
    merged: false,
    labels: [],
    url: `https://github.com/o/r/pull/${number}`,
    headRef: `claude/issue-${number}-x`,
    headSha: `head-${number}`,
    mergeCommitSha: null,
    createdAt: at(NOW - 20 * DAY),
    updatedAt: at(NOW - updatedAgoMs),
    mergedAt: null,
    ...options,
  };
}

function comment(id: number, issueNumber: number, createdAgoMs: number): CommentData {
  return { id, issueNumber, author: "claude[bot]", body: `c${id}`, createdAt: at(NOW - createdAgoMs) };
}

function parts(over: Partial<RepoParts> = {}): RepoParts {
  return { issues: [], pulls: [], comments: [], pullChecks: {}, events: [], ...over };
}

describe("mergeRepoParts（前の結果に差分を混ぜる）", () => {
  const HOUR = 60 * 60_000;

  it("更新：差分で読んだ番号は、Issue もコメントも差分の物に置き換える", () => {
    const base = parts({
      issues: [issue(1, 2 * HOUR, { title: "old" }), issue(2, 3 * HOUR)],
      comments: [comment(10, 1, 2 * HOUR), comment(20, 2, 3 * HOUR)],
    });
    const delta = parts({ issues: [issue(1, 0, { title: "new" })], comments: [comment(10, 1, 2 * HOUR), comment(11, 1, 0)] });
    const merged = mergeRepoParts(base, delta, new Set([1]), CUTOFF);
    expect(merged.issues.map((i) => [i.number, i.title])).toEqual([
      [1, "new"],
      [2, "issue 2"],
    ]);
    expect(merged.comments.map((c) => c.id)).toEqual([20, 10, 11]);
  });

  it("新規：前に無かった PR を足し、チェックも差分の物を持つ", () => {
    const base = parts({ pulls: [pull(5, 2 * HOUR)], pullChecks: { 5: { checkRuns: [], statuses: [] } } });
    const checks = { checkRuns: [{ name: "ci", status: "completed", conclusion: "success", appSlug: null, completedAt: null }], statuses: [] };
    const delta = parts({ pulls: [pull(6, 0)], pullChecks: { 6: checks } });
    const merged = mergeRepoParts(base, delta, new Set([6]), CUTOFF);
    expect(merged.pulls.map((p) => p.number)).toEqual([6, 5]);
    expect(merged.pullChecks).toEqual({ 5: { checkRuns: [], statuses: [] }, 6: checks });
  });

  it("閉じた：差分で閉じた PR は、チェックを持たない物に置き換わる（前のチェックは残さない）", () => {
    const base = parts({ pulls: [pull(5, 2 * HOUR)], pullChecks: { 5: { checkRuns: [], statuses: [] } } });
    const delta = parts({ pulls: [pull(5, 0, { state: "closed" })] });
    const merged = mergeRepoParts(base, delta, new Set([5]), CUTOFF);
    expect(merged.pulls[0].state).toBe("closed");
    expect(merged.pullChecks).toEqual({});
  });

  it("14日を過ぎた：前の結果の Issue・PR・コメント・ラベルの付け外しは、直近14日で絞り直す", () => {
    const base = parts({
      issues: [issue(1, 13 * DAY), issue(2, 14 * DAY + HOUR)],
      pulls: [pull(3, 14 * DAY + HOUR)],
      comments: [comment(10, 1, 13 * DAY), comment(11, 1, 14 * DAY + HOUR), comment(30, 3, 14 * DAY + 2 * HOUR)],
      events: [
        { event: "labeled", labelName: "x", issueNumber: 2, createdAt: at(NOW - 15 * DAY) },
        { event: "labeled", labelName: "y", issueNumber: 1, createdAt: at(NOW - 15 * DAY) },
      ],
      pullChecks: { 3: { checkRuns: [], statuses: [] } },
    });
    const merged = mergeRepoParts(base, parts(), new Set(), CUTOFF);
    expect(merged.issues.map((i) => i.number)).toEqual([1]);
    expect(merged.pulls).toEqual([]);
    expect(merged.comments.map((c) => c.id)).toEqual([10]);
    expect(merged.events.map((e) => e.labelName)).toEqual(["y"]);
    expect(merged.pullChecks).toEqual({});
  });

  it("人間待ちの Issue は14日を過ぎても残し、閉じて人間待ちでなくなったら落とす", () => {
    const waiting = issue(1, 20 * DAY, { labels: ["ai:stuck"] });
    const base = parts({ issues: [waiting], comments: [comment(10, 1, 20 * DAY)] });
    const kept = mergeRepoParts(base, parts(), new Set(), CUTOFF);
    expect(kept.issues.map((i) => i.number)).toEqual([1]);
    expect(kept.comments.map((c) => c.id)).toEqual([10]);
    const closed = { ...waiting, state: "closed" as const };
    expect(mergeRepoParts(parts({ issues: [closed] }), parts(), new Set(), CUTOFF).issues).toEqual([]);
  });

  it("差分で読んだのに直近14日の外だった物（開いていて古い PR）は、前の結果からも落とす", () => {
    const base = parts({ pulls: [pull(5, 2 * HOUR)] });
    expect(mergeRepoParts(base, parts(), new Set([5]), CUTOFF).pulls).toEqual([]);
  });

  it("並びは全部を読んだときと同じ：更新の新しい順、そのあと古い人間待ちの Issue をラベルの順に", () => {
    const base = parts({
      issues: [
        issue(1, 3 * HOUR),
        issue(7, 20 * DAY, { labels: ["ai:question"] }),
        issue(8, 21 * DAY, { labels: ["ai:stuck"] }),
      ],
    });
    const delta = parts({ issues: [issue(2, HOUR)] });
    const merged = mergeRepoParts(base, delta, new Set([2]), CUTOFF);
    expect(merged.issues.map((i) => i.number)).toEqual([2, 1, 8, 7]);
  });
});
