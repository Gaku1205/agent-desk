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

/** 答える欄が要る物（質問・工場の相談）か。ここでは押せず、その Issue の「あなたの番」を開く */
export function needsAnswerForm(item: Pick<TurnItem, "status">): boolean {
  return item.status.stage === "question" || item.status.stage === "factoryTalk";
}

/** 答える欄が要る物のリンクの文字 */
export function answerLinkLabel(item: Pick<TurnItem, "status">): string {
  return item.status.stage === "factoryTalk" ? "相談に答える" : "答える";
}
