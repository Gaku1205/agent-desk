import { isWaitingIssue, WAITING_LABELS, type RepoParts } from "./graphql";
import type {
  CommentData,
  GitHubErrorKind,
  IssueData,
  IssueEventData,
  PullChecks,
  PullData,
  RepoSyncInfo,
} from "./types";

// 大きいリポジトリの読み直しを差分だけにする（docs/spec.md の「データの取得」の「差分だけ読む」）。
// 読み方を決める・混ぜる純粋関数。GitHub を呼ぶ所は fetch.ts

const DAY_MS = 24 * 60 * 60 * 1000;

/** これより前に全部を読んだ結果には、差分を混ぜず、全部を読み直す（削除された物・取りこぼしを片づけるため） */
export const FULL_READ_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** 前に読んだ時刻から、この分だけさかのぼって読む（GitHub の時刻とのずれ・読んでいる途中の更新に備える） */
export const DELTA_OVERLAP_MS = 2 * 60 * 1000;
/**
 * 状態を問わず、この長さの間に更新された物は毎回読み直す（マージの後に付く公開のステータス・閉じた後の進捗ログの書き換えは、
 * Issue・PR の更新時刻を動かさないため）
 */
export const RECENT_REREAD_MS = 60 * 60 * 1000;

export type ReadPlan = { mode: "full" } | { mode: "delta"; sinceMs: number };

/**
 * 読み方を決める。前の結果が無い・読んだ時刻が読めない・未来・最後に全部を読んでから6時間以上たった・
 * さかのぼる時刻が直近14日の境目より前なら、全部を読む。それ以外は、`sinceMs` より後に更新された物を読む
 * （前に読んだ時刻の2分前と、1時間前の早い方）
 */
export function planRepoRead(base: RepoSyncInfo | null | undefined, nowMs: number, cutoffMs: number): ReadPlan {
  if (!base) return { mode: "full" };
  const readAt = Date.parse(base.readAt);
  const fullAt = Date.parse(base.fullAt);
  if (Number.isNaN(readAt) || Number.isNaN(fullAt)) return { mode: "full" };
  if (readAt > nowMs || fullAt > readAt) return { mode: "full" };
  if (nowMs - fullAt >= FULL_READ_INTERVAL_MS) return { mode: "full" };
  const sinceMs = Math.min(readAt - DELTA_OVERLAP_MS, nowMs - RECENT_REREAD_MS);
  if (sinceMs < cutoffMs) return { mode: "full" };
  return { mode: "delta", sinceMs };
}

/**
 * 差分の読みが失敗したとき、その回のうちに全部を読み直すか。回数制限・鍵の権限・見つからないは、全部を読んでも同じなので読み直さない
 * （`null`＝GitHub のエラーでない失敗。読み直す）
 */
export function shouldReadFullAfterDeltaError(kind: GitHubErrorKind | null): boolean {
  return kind === null || kind === "other";
}

/**
 * PR の一覧（更新の新しい順）を、続きのページまで読むか。そのページのいちばん古い物が `sinceMs` 以降のときだけ読む
 * （それより古い物が出たら止める）
 */
export function shouldReadMorePulls(oldestUpdatedAt: string | undefined, sinceMs: number): boolean {
  return oldestUpdatedAt !== undefined && Date.parse(oldestUpdatedAt) >= sinceMs;
}

/** 番号ごとに分ける（並びは保つ） */
function groupByNumber<T>(items: T[], numberOf: (item: T) => number | null): Map<number, T[]> {
  const groups = new Map<number, T[]>();
  for (const item of items) {
    const number = numberOf(item);
    if (number === null) continue;
    const group = groups.get(number);
    if (group) group.push(item);
    else groups.set(number, [item]);
  }
  return groups;
}

const byUpdatedDesc = <T extends { updatedAt: string }>(a: T, b: T): number =>
  Date.parse(b.updatedAt) - Date.parse(a.updatedAt);

/**
 * Issue を、全部を読んだときと同じ並びにする：問い合わせの境目（直近14日の境目の日の0時）以降に更新された物を新しい順に、
 * そのあとに、それより古い人間待ちの Issue をラベルの順（`WAITING_LABELS`）に、それぞれ新しい順で
 */
function orderIssues(issues: IssueData[], sinceDayMs: number): IssueData[] {
  const recent = issues.filter((issue) => Date.parse(issue.updatedAt) >= sinceDayMs).sort(byUpdatedDesc);
  const older = issues.filter((issue) => Date.parse(issue.updatedAt) < sinceDayMs).sort(byUpdatedDesc);
  const placed = new Set(recent.map((issue) => issue.number));
  const ordered = [...recent];
  for (const label of WAITING_LABELS) {
    for (const issue of older) {
      if (placed.has(issue.number) || !issue.labels.includes(label)) continue;
      placed.add(issue.number);
      ordered.push(issue);
    }
  }
  return ordered;
}

/**
 * 前に読んだ結果（`base`）に、差分の読みの結果（`delta`。直近14日に絞った後の物）を混ぜる。
 * `touched` は、差分の読みで GitHub が返した Issue・PR の番号の全部（直近14日の外に出た物も入れる）。
 * - 差分で読んだ番号の物（Issue・PR・コメント・ラベルの付け外し・チェック）は、差分の物に置き換える（無くなった物は落とす）
 * - そのほかは前の結果のまま。ただし、直近14日（`cutoffMs`）の外に出た物は、全部を読んだときと同じ決まりで落とす
 *   （人間待ちの Issue は絞らない。閉じて人間待ちでなくなった物は絞る。コメントは作成時刻で絞る）
 * - 並びも、全部を読んだときと同じにする
 */
export function mergeRepoParts(base: RepoParts, delta: RepoParts, touched: ReadonlySet<number>, cutoffMs: number): RepoParts {
  const sinceDayMs = Math.floor(cutoffMs / DAY_MS) * DAY_MS;
  const keptIssues = base.issues.filter((issue) => !touched.has(issue.number));
  const issues = orderIssues(
    [...delta.issues, ...keptIssues].filter((issue) => isWaitingIssue(issue) || Date.parse(issue.updatedAt) >= cutoffMs),
    sinceDayMs,
  );
  const pulls: PullData[] = [...delta.pulls, ...base.pulls.filter((pull) => !touched.has(pull.number))]
    .filter((pull) => Date.parse(pull.updatedAt) >= cutoffMs)
    .sort(byUpdatedDesc);

  const deltaComments = groupByNumber(delta.comments, (comment) => comment.issueNumber);
  const baseComments = groupByNumber(base.comments, (comment) => comment.issueNumber);
  const deltaEvents = groupByNumber(delta.events, (event) => event.issueNumber);
  const baseEvents = groupByNumber(base.events, (event) => event.issueNumber);
  const pick = <T>(number: number, fromDelta: Map<number, T[]>, fromBase: Map<number, T[]>): T[] =>
    (touched.has(number) ? fromDelta.get(number) : fromBase.get(number)) ?? [];

  const waitingNumbers = new Set(issues.filter(isWaitingIssue).map((issue) => issue.number));
  const comments: CommentData[] = [];
  const events: IssueEventData[] = [];
  const pullChecks: Record<number, PullChecks> = {};
  for (const { number } of [...issues, ...pulls]) {
    comments.push(...pick(number, deltaComments, baseComments));
    events.push(...pick(number, deltaEvents, baseEvents));
  }
  for (const { number } of pulls) {
    const checks = touched.has(number) ? delta.pullChecks[number] : base.pullChecks[number];
    if (checks) pullChecks[number] = checks;
  }
  return {
    issues,
    pulls,
    comments: comments
      .filter((comment) => Date.parse(comment.createdAt) >= cutoffMs || waitingNumbers.has(comment.issueNumber))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id - b.id),
    pullChecks,
    events: events.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  };
}
