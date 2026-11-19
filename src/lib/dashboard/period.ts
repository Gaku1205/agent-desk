/** Dashboard の期間（`24h`・`7d`・`30d`）。`24h`・`7d` は前の期間も直近14日の中に収まる。`30d` は前の30日を合わせて60日分が要る */

export const PERIOD_KEYS = ["24h", "7d", "30d"] as const;
export type PeriodKey = (typeof PERIOD_KEYS)[number];

/** URL の `?period=` を期間にする。分からない値・無い値は undefined（既定の `24h`） */
export function parsePeriodParam(value: string | string[] | undefined): PeriodKey | undefined {
  const first = Array.isArray(value) ? value[0] : value;
  return PERIOD_KEYS.find((key) => key === first);
}

/** `loadTurns` の直近14日だけで数えられる期間（追加で GitHub を読まない） */
export const LOCAL_PERIOD_KEYS = ["24h", "7d"] as const;
export type LocalPeriodKey = (typeof LOCAL_PERIOD_KEYS)[number];

/** 30日分の取得（`src/lib/github/extended.ts`）が要る期間か */
export function needsExtendedData(key: PeriodKey): boolean {
  return !(LOCAL_PERIOD_KEYS as readonly PeriodKey[]).includes(key);
}

/** 30日分の取得がさかのぼる日数（30日＋前の30日） */
export const EXTENDED_DAYS = 60;

const HOUR_MS = 60 * 60 * 1000;
const JST_OFFSET_MS = 9 * HOUR_MS;

const PERIOD_MS: Record<PeriodKey, number> = {
  "24h": 24 * HOUR_MS,
  "7d": 7 * 24 * HOUR_MS,
  "30d": 30 * 24 * HOUR_MS,
};

/** まとめの文の「この24時間で」「この7日で」 */
const PERIOD_WORD: Record<PeriodKey, string> = {
  "24h": "24時間",
  "7d": "7日",
  "30d": "30日",
};

export type PeriodRange = {
  /** 期間の始め（含む） */
  start: number;
  /** 期間の終わり＝「今」（含まない） */
  end: number;
  /** その前の同じ長さの期間の始め */
  prevStart: number;
};

/** 「今」から期間をさかのぼった範囲と、その前の同じ長さの期間の始め */
export function periodRange(now: Date, key: PeriodKey): PeriodRange {
  const end = now.getTime();
  const start = end - PERIOD_MS[key];
  return { start, end, prevStart: start - PERIOD_MS[key] };
}

/** 時刻が期間（始め以上・終わり未満）の中か */
export function inRange(time: number, from: number, to: number): boolean {
  return time >= from && time < to;
}

export function periodWord(key: PeriodKey): string {
  return PERIOD_WORD[key];
}

/** 日本時間の `11/17 11:00` */
function formatPoint(time: number): string {
  const iso = new Date(time + JST_OFFSET_MS).toISOString();
  return `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))} ${iso.slice(11, 16)}`;
}

/** 見出しの下の期間：`11/17 11:00 〜 11/18 11:00 · 12リポジトリ`（日本時間。終わりは表示した「今」） */
export function formatPeriodLabel(now: Date, key: PeriodKey, repoCount: number): string {
  const { start, end } = periodRange(now, key);
  return `${formatPoint(start)} 〜 ${formatPoint(end)} · ${repoCount}リポジトリ`;
}
