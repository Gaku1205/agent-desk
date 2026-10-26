import { NOTIFY_EVENT_KINDS, type NotifyEvent } from "@/lib/notifyEvents";

export type NotifyDraft = {
  /** `owner/repo` */
  name: string;
  /** パイプラインがあるか。無ければ保存しない */
  pipeline: boolean;
  /** 最後に保存した（または読み込んだ）状態 */
  saved: readonly NotifyEvent[];
  /** いま画面でチェックされている状態 */
  current: readonly NotifyEvent[];
};

/** 順番に関係なく、同じ種類の集まりか */
export function sameEvents(a: readonly NotifyEvent[], b: readonly NotifyEvent[]): boolean {
  return NOTIFY_EVENT_KINDS.every((kind) => a.includes(kind) === b.includes(kind));
}

/** 保存が必要なリポジトリだけを返す（パイプラインが無い列と、変わっていない列は除く） */
export function changedRepos(drafts: readonly NotifyDraft[]): NotifyDraft[] {
  return drafts.filter((d) => d.pipeline && !sameEvents(d.saved, d.current));
}

/** 失敗の表示文。2つ以上のリポジトリで失敗したときは、どれか分かるようにリポジトリ名を付ける */
export function formatSaveFailures(
  failures: readonly { name: string; message: string }[],
  attempted: number,
): string {
  if (failures.length === 0) return "";
  if (attempted <= 1) return failures[0].message;
  return failures.map((f) => `${f.name}：${f.message}`).join(" / ");
}
