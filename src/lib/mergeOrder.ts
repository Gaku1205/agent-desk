import { turnItemKey, type TurnItem } from "./turn";

/** マージ待ちの一覧に出す1件か（人間の番の `ai:hold` のマージ待ち。Issueに紐づく物も紐づかない物も） */
export function isMergeQueueItem(item: TurnItem): boolean {
  return (
    item.merge !== null &&
    item.status.stage === "mergeWaiting" &&
    item.status.mergeWait === "hold" &&
    item.buttons.some((button) => button.type === "operation" && button.kind === "merge")
  );
}

/** マージの一覧を出すマージ待ちの件数（これ以上のとき、大きい1件の代わりに一覧を出す） */
export const MERGE_QUEUE_FROM = 2;

function repoKey(item: TurnItem): string {
  return `${item.owner}/${item.repo}`.toLowerCase();
}

/** 順番待ちを止めている数（「止めている印」の数） */
function blockingCount(item: TurnItem): number {
  return item.blocking?.length ?? 0;
}

/** 同じリポジトリのほかのPRと、変更ファイルの名前が1つでも同じ相手の数 */
function overlapCount(item: TurnItem, items: TurnItem[]): number {
  const mine = new Set(item.files ?? []);
  if (mine.size === 0) return 0;
  const key = turnItemKey(item);
  const repo = repoKey(item);
  return items.filter(
    (other) =>
      turnItemKey(other) !== key &&
      repoKey(other) === repo &&
      (other.files ?? []).some((file) => mine.has(file)),
  ).length;
}

/** PR番号（Issueに紐づく物はPRの番号、紐づかない物は行の番号） */
function pullNumber(item: TurnItem): number {
  return item.pullOnly ? item.issue.number : (item.merge?.pullNumber ?? item.issue.number);
}

/**
 * マージ待ちを、すすめる順に並べる（docs/spec.md の「マージ待ちの一覧」）。
 * 1) 順番待ちを止めている数が多い順、2) 触るファイルが重なる相手の数が多い順（同じリポジトリのPRどうしだけ）、
 * 3) 古い順（PR番号の小さい順）。上から比べ、同じなら次で決める。元の並びは変えない
 */
export function orderMergeQueue(items: TurnItem[]): TurnItem[] {
  const overlaps = new Map(items.map((item) => [turnItemKey(item), overlapCount(item, items)]));
  return [...items].sort((a, b) => {
    const byBlocking = blockingCount(b) - blockingCount(a);
    if (byBlocking !== 0) return byBlocking;
    const byOverlap = (overlaps.get(turnItemKey(b)) ?? 0) - (overlaps.get(turnItemKey(a)) ?? 0);
    if (byOverlap !== 0) return byOverlap;
    return pullNumber(a) - pullNumber(b);
  });
}
