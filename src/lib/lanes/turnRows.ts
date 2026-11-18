import { isMergeQueueItem, MERGE_QUEUE_FROM, orderMergeQueue } from "../mergeOrder";
import { compareTurnItems, type TurnItem } from "../turn";

/**
 * Slots & Queue の Your turn に並べる順（docs/spec.md の「Slots & Queue」）。
 * 今の「あなたの番」と同じ並び（`compareTurnItems`）。マージ待ちが2件以上なら、マージ待ちの行どうしだけを
 * 「すすめる順」（`orderMergeQueue`）に入れ替える（ほかの行の位置は変えない）
 */
export function lanesTurnRows(items: readonly TurnItem[]): TurnItem[] {
  const sorted = [...items].sort(compareTurnItems);
  const merges = sorted.filter(isMergeQueueItem);
  if (merges.length < MERGE_QUEUE_FROM) return sorted;
  const ordered = orderMergeQueue(merges);
  let next = 0;
  return sorted.map((item) => (isMergeQueueItem(item) ? ordered[next++] : item));
}

/**
 * マージ待ちの行に付ける「すすめる順」の数（上から数えて 1, 2, …）。キーは行の位置。
 * マージ待ちが `MERGE_QUEUE_FROM` 件未満なら、どの行にも付けない（空の Map）
 */
export function mergeOrdinals(rows: readonly TurnItem[]): Map<number, number> {
  const result = new Map<number, number>();
  const count = rows.filter(isMergeQueueItem).length;
  if (count < MERGE_QUEUE_FROM) return result;
  let n = 0;
  rows.forEach((item, index) => {
    if (isMergeQueueItem(item)) result.set(index, ++n);
  });
  return result;
}

/** 答える欄が要る物（質問・工場の相談）か。ここでは押せず、その Issue の「あなたの番」を開く */
export function needsAnswerForm(item: Pick<TurnItem, "status">): boolean {
  return item.status.stage === "question" || item.status.stage === "factoryTalk";
}

/** 答える欄が要る物のリンクの文字 */
export function answerLinkLabel(item: Pick<TurnItem, "status">): string {
  return item.status.stage === "factoryTalk" ? "相談に答える" : "答える";
}
