/** 通知の種類（`.github/scripts/notify.sh` と同じ並び・同じ名前） */
export const NOTIFY_EVENT_KINDS = [
  "stuck",
  "question",
  "hold",
  "manual",
  "deployed",
  "deploy_failed",
  "merged",
  "ci_failed",
] as const;

export type NotifyEvent = (typeof NOTIFY_EVENT_KINDS)[number];

/** 通知の種類を保存する Variable の名前 */
export const NOTIFY_EVENTS_VARIABLE = "NOTIFY_EVENTS";

/** Variable が無いときに鳴らす種類（`notify.sh` の `DEFAULT_EVENTS`） */
export const DEFAULT_NOTIFY_EVENTS: readonly NotifyEvent[] = [
  "stuck",
  "question",
  "hold",
  "manual",
  "deployed",
  "deploy_failed",
];

/** 画面に出す名前と短い説明 */
export const NOTIFY_EVENT_LABELS: Record<NotifyEvent, { name: string; description: string }> = {
  stuck: { name: "止まった", description: "確認が必要なとき" },
  question: { name: "質問がある", description: "企画AIから質問があるとき" },
  hold: { name: "マージ待ち（ai:hold）", description: "マージを押せるようになったとき" },
  manual: { name: "操作待ち（トークン無し）", description: "PR作成などを人間がするとき" },
  deployed: { name: "公開された", description: "本番に公開されたとき" },
  deploy_failed: { name: "公開に失敗", description: "公開に失敗したとき" },
  merged: { name: "自動でマージした", description: "AIがPRをマージしたとき" },
  ci_failed: { name: "CIが失敗した", description: "AIが直す前のCI失敗" },
};

export const NOTIFY_MESSAGES = {
  invalid: "通知の種類が正しくありません",
  empty: "通知の種類を1つ以上選んでください",
  noPipeline: "パイプラインが入っていないリポジトリは変えられません",
} as const;

function isNotifyEvent(value: unknown): value is NotifyEvent {
  return typeof value === "string" && (NOTIFY_EVENT_KINDS as readonly string[]).includes(value);
}

/**
 * Variable の値（カンマ区切り）を、決まった並びの種類の配列にする。
 * 無い・空・読めない値のときは初期値。知らない種類は読み飛ばす
 */
export function parseNotifyEvents(value: string | null): NotifyEvent[] {
  if (value === null) return [...DEFAULT_NOTIFY_EVENTS];
  const found = new Set(
    value
      .split(",")
      .map((item) => item.trim())
      .filter(isNotifyEvent),
  );
  if (found.size === 0) return [...DEFAULT_NOTIFY_EVENTS];
  return NOTIFY_EVENT_KINDS.filter((kind) => found.has(kind));
}

export type NotifyEventsCheck =
  | { ok: true; events: NotifyEvent[] }
  | { ok: false; message: string };

/**
 * ブラウザから来た通知の種類を確かめる（Server Actionは誰でも直接呼べるため）。
 * 知っている種類の文字列の配列だけを受け付け、重複は1つにして決まった並びにそろえる。0件は不可
 * （`notify.sh` は空の `NOTIFY_EVENTS` を初期値として扱うため、空では保存できない）
 */
export function checkNotifyEvents(value: unknown): NotifyEventsCheck {
  if (!Array.isArray(value)) return { ok: false, message: NOTIFY_MESSAGES.invalid };
  const chosen = new Set<NotifyEvent>();
  for (const item of value) {
    if (!isNotifyEvent(item)) return { ok: false, message: NOTIFY_MESSAGES.invalid };
    chosen.add(item);
  }
  if (chosen.size === 0) return { ok: false, message: NOTIFY_MESSAGES.empty };
  return { ok: true, events: NOTIFY_EVENT_KINDS.filter((kind) => chosen.has(kind)) };
}

/** Variable に書く値（種類のカンマ区切り） */
export function formatNotifyEvents(events: readonly NotifyEvent[]): string {
  return events.join(",");
}
