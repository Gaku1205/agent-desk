import type { AddedNotice } from "./autoAdd";
import type { ChatMessage } from "./conversation";

/**
 * 中央のいちばん上の「古い会話」（docs/spec.md の「いまの様子」の「過去の欄」）。
 * 公開済みと、監視に追加したお知らせを、日ごとに古い順に並べる
 */

/** 最初に出す件数 */
export const PAST_INITIAL = 5;
/** 上の端までスクロールする・「さらに前を読む」を押したときに読み足す件数 */
export const PAST_STEP = 10;

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
/** 日の区切りと時刻は日本時間（UTC+9）で決める。サーバーと画面で同じ結果にするため */
const JST_OFFSET_MS = 9 * 60 * MINUTE_MS;

export type PastItem =
  | { kind: "deployed"; key: string; at: string; message: ChatMessage }
  | { kind: "added"; key: string; at: string; owner: string; repo: string };

/** 日の見出しと、その日の物（古い順） */
export type PastDay = { key: string; label: string; items: PastItem[] };

/** 日本時間の、その日の0時からの通し日数（日の比べ方に使う）。読めない時刻は null */
function jstDayNumber(iso: string): number | null {
  const time = Date.parse(iso);
  return Number.isNaN(time) ? null : Math.floor((time + JST_OFFSET_MS) / DAY_MS);
}

/** 日本時間の `YYYY-MM-DD`。読めない時刻は空文字 */
export function dayKey(iso: string): string {
  const time = Date.parse(iso);
  return Number.isNaN(time) ? "" : new Date(time + JST_OFFSET_MS).toISOString().slice(0, 10);
}

/** 日の見出し：`今日`・`昨日`・それより前は `11月15日` */
export function dayLabel(iso: string, now: Date): string {
  const day = jstDayNumber(iso);
  const today = jstDayNumber(now.toISOString());
  if (day === null || today === null) return "";
  if (day >= today) return "今日";
  if (day === today - 1) return "昨日";
  const shifted = new Date(Date.parse(iso) + JST_OFFSET_MS);
  return `${shifted.getUTCMonth() + 1}月${shifted.getUTCDate()}日`;
}

/** 時刻 `09:20`（日本時間。日付は付けない） */
export function clockTime(iso: string): string {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return "";
  return new Date(time + JST_OFFSET_MS).toISOString().slice(11, 16);
}

/** 監視に追加したお知らせの1行：`＋ tochi-rirekisho を監視に追加` */
export function addedPastText(repo: string): string {
  return `＋ ${repo} を監視に追加`;
}

/**
 * 過去の欄に並べる物：公開済みのメッセージ（時刻は `doneAt`。無ければ出さない）と、監視に追加したお知らせ。
 * 時刻の古い順（同じ時刻はキー順）
 */
export function buildPastItems(messages: ChatMessage[], added: AddedNotice[]): PastItem[] {
  const items: PastItem[] = [];
  for (const message of messages) {
    if (!message.deployed || message.doneAt === null || Number.isNaN(Date.parse(message.doneAt))) continue;
    items.push({ kind: "deployed", key: message.key, at: message.doneAt, message });
  }
  for (const notice of added) {
    if (Number.isNaN(Date.parse(notice.at))) continue;
    items.push({ kind: "added", key: `added:${notice.owner}/${notice.repo}`, at: notice.at, owner: notice.owner, repo: notice.repo });
  }
  return items.sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.key.localeCompare(b.key));
}

/** 出す件数：最初の5件に、読み足した分を足す。全部を超えない */
export function visibleCount(total: number, loaded: number): number {
  return Math.min(total, PAST_INITIAL + Math.max(0, loaded));
}

/** 新しい方から数えて `count` 件（古い順のまま） */
export function visiblePast(items: PastItem[], count: number): PastItem[] {
  return count <= 0 ? [] : items.slice(-count);
}

/** 日ごとにまとめる（古い日が先。同じ日の中は古い順のまま） */
export function groupByDay(items: PastItem[], now: Date): PastDay[] {
  const days: PastDay[] = [];
  for (const item of items) {
    const key = dayKey(item.at);
    const last = days[days.length - 1];
    if (last && last.key === key) last.items.push(item);
    else days.push({ key, label: dayLabel(item.at, now), items: [item] });
  }
  return days;
}
