import {
  currentPeriod,
  DEFAULT_PARALLEL_TZ,
  isNightHour,
  PARALLEL_MESSAGES,
  type NightHours,
  type ParallelPeriod,
} from "./parallel";

/** 帯の1つの区間（hours 時から。end は含まない） */
export type Span = { start: number; end: number };

/** 「Off」（夜を使わない）の選択欄の値 */
export const NIGHT_OFF = "Off";

/** 始まりが Off から選ばれたときの、夜の長さ（時間）。終わりは始まりのこの時間後 */
export const DEFAULT_NIGHT_LENGTH = 8;

/** 選択欄の時刻の一覧（0:00〜23:00） */
export const HOUR_OPTIONS: string[] = Array.from({ length: 24 }, (_, hour) => `${hour}:00`);

/** 始まりの選択欄の一覧（いちばん上が Off） */
export const START_OPTIONS: string[] = [NIGHT_OFF, ...HOUR_OPTIONS];

/** 夜の区間（日またぎなら左右の2つ）。夜が無ければ空 */
export function nightSpans(hours: NightHours | null): Span[] {
  if (!hours || hours.start === hours.end) return [];
  if (hours.start < hours.end) return [{ start: hours.start, end: hours.end }];
  const spans: Span[] = [];
  if (hours.end > 0) spans.push({ start: 0, end: hours.end });
  spans.push({ start: hours.start, end: 24 });
  return spans;
}

/** 昼の区間（夜の残り。夜が無ければ 0〜24 の1つ） */
export function daySpans(hours: NightHours | null): Span[] {
  const spans: Span[] = [];
  for (let hour = 0; hour < 24; ) {
    if (isNightHour(hour, hours)) {
      hour += 1;
      continue;
    }
    let end = hour;
    while (end < 24 && !isNightHour(end, hours)) end += 1;
    spans.push({ start: hour, end });
    hour = end;
  }
  return spans;
}

/** 件数を載せる区間：いちばん長い区間。同じ長さなら先の区間。区間が無ければ null */
export function pickCountSpan(spans: readonly Span[]): Span | null {
  let best: Span | null = null;
  for (const span of spans) {
    if (best === null || span.end - span.start > best.end - best.start) best = span;
  }
  return best;
}

/** 区間の真ん中の位置（0〜1。帯の幅に対する割合） */
export function spanCenter(span: Span): number {
  return (span.start + span.end) / 2 / 24;
}

/** 選択欄の始まりの値（夜が無ければ Off） */
export function startSelectValue(hours: NightHours | null): string {
  return hours ? `${hours.start}:00` : NIGHT_OFF;
}

/** 選択欄の終わりの値（夜が無ければ空） */
export function endSelectValue(hours: NightHours | null): string {
  return hours ? `${hours.end}:00` : "";
}

/** `7:00` → 7。読めなければ null */
export function parseHourOption(value: string): number | null {
  const match = /^(\d{1,2}):00$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  return hour >= 0 && hour <= 23 ? hour : null;
}

export type SelectChange = { kind: "set"; hours: NightHours | null } | { kind: "error"; message: string };

/** 始まりの選択欄で選んだとき：Off なら夜なし。Off から選んだら、終わりは始まりの8時間後。終わりと同じ時刻なら受け付けない */
export function changeNightStart(hours: NightHours | null, value: string): SelectChange {
  if (value === NIGHT_OFF) return { kind: "set", hours: null };
  const start = parseHourOption(value);
  if (start === null) return { kind: "error", message: PARALLEL_MESSAGES.sameHours };
  if (hours === null) return { kind: "set", hours: { start, end: (start + DEFAULT_NIGHT_LENGTH) % 24 } };
  if (start === hours.end) return { kind: "error", message: PARALLEL_MESSAGES.sameHours };
  return { kind: "set", hours: { start, end: hours.end } };
}

/** 終わりの選択欄で選んだとき：始まりと同じ時刻なら受け付けない */
export function changeNightEnd(hours: NightHours | null, value: string): SelectChange {
  const end = parseHourOption(value);
  if (hours === null || end === null || end === hours.start) {
    return { kind: "error", message: PARALLEL_MESSAGES.sameHours };
  }
  return { kind: "set", hours: { start: hours.start, end } };
}

function partsInZone(now: Date, timeZone: string): { hour: number; minute: number } {
  function partsIn(zone: string): { hour: number; minute: number } {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hour: "numeric",
      minute: "numeric",
      hourCycle: "h23",
    }).formatToParts(now);
    const hour = Number(parts.find((part) => part.type === "hour")?.value);
    const minute = Number(parts.find((part) => part.type === "minute")?.value);
    return { hour: hour === 24 ? 0 : hour, minute };
  }
  try {
    return partsIn(timeZone);
  } catch {
    return partsIn(DEFAULT_PARALLEL_TZ);
  }
}

/** 「今」の縦線の位置（0〜1。今の時＋分） */
export function nowPosition(now: Date, timeZone: string = DEFAULT_PARALLEL_TZ): number {
  const { hour, minute } = partsInZone(now, timeZone);
  return (hour * 60 + minute) / (24 * 60);
}

/** 「いま 10:39 · Day」の部品：時刻（`10:39`）と昼夜（`Day`／`Night`） */
export function describeParallelNow(
  now: Date,
  hours: NightHours | null,
  timeZone: string = DEFAULT_PARALLEL_TZ,
): { time: string; period: "Day" | "Night" } {
  const { hour, minute } = partsInZone(now, timeZone);
  const period: ParallelPeriod = currentPeriod(now, hours, timeZone);
  return { time: `${hour}:${String(minute).padStart(2, "0")}`, period: period === "night" ? "Night" : "Day" };
}
