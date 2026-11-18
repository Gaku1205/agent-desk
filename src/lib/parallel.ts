/**
 * 並列の数（昼・夜）の設定。純粋関数だけ（GitHubへの読み書きは `src/lib/github/settings.ts`）。
 * 変数の名前と書き方は ai-dev-template の「並列の数を Actions の変数で決める」（#122）に合わせる
 */

/** 昼の並列の数を保存する Variable（1以上の整数。無ければ既定の3） */
export const PARALLEL_DAY_VARIABLE = "PARALLEL_DAY";
/** 夜の並列の数を保存する Variable（1以上の整数。無ければ1） */
export const PARALLEL_NIGHT_VARIABLE = "PARALLEL_NIGHT";
/** 夜の時間帯を保存する Variable（`"01-08"`。開始時-終了時。無ければ夜は無し） */
export const PARALLEL_NIGHT_HOURS_VARIABLE = "PARALLEL_NIGHT_HOURS";

export const DEFAULT_PARALLEL_DAY = 3;
export const DEFAULT_PARALLEL_NIGHT = 1;
/** 時間帯の基準（`PARALLEL_TZ` の既定。画面では変えない） */
export const DEFAULT_PARALLEL_TZ = "Asia/Tokyo";

/** 画面で選べる並列の数の最大（パイプライン側に上限は無い） */
export const PARALLEL_SELECT_MAX = 10;

/** 夜の時間帯。開始を含み、終了を含まない（`22`〜`6` のように日またぎもできる） */
export type NightHours = { start: number; end: number };

/** 保存する設定。夜の時間帯が null なら夜は無し */
export type ParallelSettings = {
  day: number;
  night: number;
  nightHours: NightHours | null;
};

export const DEFAULT_PARALLEL_SETTINGS: ParallelSettings = {
  day: DEFAULT_PARALLEL_DAY,
  night: DEFAULT_PARALLEL_NIGHT,
  nightHours: null,
};

export const PARALLEL_MESSAGES = {
  invalid: "並列の設定の形が正しくありません",
  count: "並列の数は1以上の整数にしてください",
  hours: "夜の時間帯は0〜23時で選んでください",
  sameHours: "夜の時間帯の開始と終了は、違う時刻にしてください",
  noPipeline: "パイプラインのある監視リポジトリがありません",
} as const;

function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

/** 変数の値から、1以上の整数を読む。不正（空・数でない・0以下・小数）なら既定に戻す */
export function parseParallelCount(value: string | null | undefined, fallback: number): number {
  const text = value?.trim() ?? "";
  if (!/^\d+$/.test(text)) return fallback;
  const n = Number(text);
  return Number.isSafeInteger(n) && n >= 1 ? n : fallback;
}

/**
 * 変数の値から、夜の時間帯を読む（`HH-HH`、各0〜24の整数）。
 * 無い・空・形が違う・開始と終了が同じときは null（夜は無し）
 */
export function parseNightHours(value: string | null | undefined): NightHours | null {
  const match = /^(\d{1,2})-(\d{1,2})$/.exec(value?.trim() ?? "");
  if (!match) return null;
  const start = Number(match[1]);
  const end = Number(match[2]);
  if (start > 24 || end > 24 || start === end) return null;
  return { start, end };
}

/** 3つの変数の値（読めなければ null）から設定を作る。不正な値は既定に戻す */
export function parseParallelSettings(values: {
  day: string | null | undefined;
  night: string | null | undefined;
  nightHours: string | null | undefined;
}): ParallelSettings {
  return {
    day: parseParallelCount(values.day, DEFAULT_PARALLEL_DAY),
    night: parseParallelCount(values.night, DEFAULT_PARALLEL_NIGHT),
    nightHours: parseNightHours(values.nightHours),
  };
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** 夜の時間帯を変数の値にする（`"01-08"`） */
export function formatNightHours(hours: NightHours): string {
  return `${pad2(hours.start)}-${pad2(hours.end)}`;
}

export type ParallelCheck =
  | { ok: true; settings: ParallelSettings }
  | { ok: false; message: string };

/**
 * ブラウザから来た設定を確かめる（Server Action は誰でも直接呼べるため）。
 * 数は1以上の整数、夜の時間帯は null か、開始・終了が0〜23の整数で互いに違うこと
 */
export function checkParallelSettings(value: unknown): ParallelCheck {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, message: PARALLEL_MESSAGES.invalid };
  }
  const { day, night, nightHours } = value as Record<string, unknown>;
  if (!isInteger(day) || day < 1 || !isInteger(night) || night < 1) {
    return { ok: false, message: PARALLEL_MESSAGES.count };
  }
  if (nightHours === null) return { ok: true, settings: { day, night, nightHours: null } };
  if (typeof nightHours !== "object" || Array.isArray(nightHours) || nightHours === undefined) {
    return { ok: false, message: PARALLEL_MESSAGES.invalid };
  }
  const { start, end } = nightHours as Record<string, unknown>;
  if (!isInteger(start) || !isInteger(end) || start < 0 || start > 23 || end < 0 || end > 23) {
    return { ok: false, message: PARALLEL_MESSAGES.hours };
  }
  if (start === end) return { ok: false, message: PARALLEL_MESSAGES.sameHours };
  return { ok: true, settings: { day, night, nightHours: { start, end } } };
}

/** 書く Variable 1つ。value が null なら、その Variable を消す（空の値は書けないため） */
export type ParallelWrite = { name: string; value: string | null };

/** 設定を、書く Variable の並びにする。既定と同じ値・「無し」は消す（`PARALLEL_TZ`・`PARALLEL_OVERRIDE` には触らない） */
export function buildParallelWrites(settings: ParallelSettings): ParallelWrite[] {
  return [
    {
      name: PARALLEL_DAY_VARIABLE,
      value: settings.day === DEFAULT_PARALLEL_DAY ? null : String(settings.day),
    },
    {
      name: PARALLEL_NIGHT_VARIABLE,
      value: settings.night === DEFAULT_PARALLEL_NIGHT ? null : String(settings.night),
    },
    {
      name: PARALLEL_NIGHT_HOURS_VARIABLE,
      value: settings.nightHours ? formatNightHours(settings.nightHours) : null,
    },
  ];
}

/** 同じ設定か */
export function sameParallelSettings(a: ParallelSettings, b: ParallelSettings): boolean {
  return (
    a.day === b.day &&
    a.night === b.night &&
    a.nightHours?.start === b.nightHours?.start &&
    a.nightHours?.end === b.nightHours?.end
  );
}

export type ParallelPeriod = "day" | "night";

/** 基準のタイムゾーンでの「いま何時か」（0〜23）。タイムゾーンが不正なら既定（Asia/Tokyo） */
export function hourInZone(now: Date, timeZone: string = DEFAULT_PARALLEL_TZ): number {
  function hourIn(zone: string): number {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hour: "numeric",
      hourCycle: "h23",
    }).formatToParts(now);
    const hour = Number(parts.find((part) => part.type === "hour")?.value);
    return hour === 24 ? 0 : hour;
  }
  try {
    return hourIn(timeZone);
  } catch {
    return hourIn(DEFAULT_PARALLEL_TZ);
  }
}

/** ある時刻（0〜23）が夜の時間帯に入るか。開始を含み終了を含まない。開始が終了より後なら日またぎ */
export function isNightHour(hour: number, hours: NightHours | null): boolean {
  if (!hours) return false;
  const { start, end } = hours;
  if (start === end) return false;
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

/** いまは昼か夜か（夜の時間帯が無ければいつも昼）。ai-dev-template の `parallel_limit_decide` と同じ決まり */
export function currentPeriod(
  now: Date,
  hours: NightHours | null,
  timeZone: string = DEFAULT_PARALLEL_TZ,
): ParallelPeriod {
  return isNightHour(hourInZone(now, timeZone), hours) ? "night" : "day";
}

/** いまの並列の上限 */
export function currentParallelLimit(
  now: Date,
  settings: ParallelSettings,
  timeZone: string = DEFAULT_PARALLEL_TZ,
): number {
  return currentPeriod(now, settings.nightHours, timeZone) === "night" ? settings.night : settings.day;
}

/** 手の上書きを保存する Variable（`"night until 2026-11-18T08:00+09:00"`。期限を過ぎる・形が違うとパイプラインは無視する） */
export const PARALLEL_OVERRIDE_VARIABLE = "PARALLEL_OVERRIDE";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
/** 上書きの期限を書くときの時差（`DEFAULT_PARALLEL_TZ` は夏時間の無い +09:00） */
const OVERRIDE_OFFSET_MS = 9 * HOUR_MS;

/** 手の上書き：期限まで、昼か夜の上限にする */
export type ParallelOverride = { period: ParallelPeriod; until: Date };

const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

/** 変数の値から、上書きを読む（`night until …`／`day until …`）。形が違えば null（期限の過ぎ具合は見ない） */
export function parseParallelOverride(value: string | null | undefined): ParallelOverride | null {
  const match = /^(day|night) until (\S+)$/.exec(value?.trim() ?? "");
  if (!match || !ISO_8601.test(match[2])) return null;
  const until = new Date(match[2]);
  if (Number.isNaN(until.getTime())) return null;
  return { period: match[1] as ParallelPeriod, until };
}

/** 上書きを変数の値にする（`"night until 2026-11-18T08:00+09:00"`。日本時間の分まで） */
export function formatParallelOverride(override: ParallelOverride): string {
  const shifted = new Date(override.until.getTime() + OVERRIDE_OFFSET_MS);
  return `${override.period} until ${shifted.toISOString().slice(0, 16)}+09:00`;
}

/** いま効いている上書き（期限が過ぎた・形が違う物は null） */
export function activeParallelOverride(
  value: string | null | undefined,
  now: Date,
): ParallelOverride | null {
  const override = parseParallelOverride(value);
  return override && override.until.getTime() > now.getTime() ? override : null;
}

function minuteInZone(now: Date, timeZone: string): number {
  function minuteIn(zone: string): number {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, minute: "numeric" }).formatToParts(now);
    return Number(parts.find((part) => part.type === "minute")?.value) || 0;
  }
  try {
    return minuteIn(timeZone);
  } catch {
    return minuteIn(DEFAULT_PARALLEL_TZ);
  }
}

/**
 * 手で切り替えたときの期限＝次の時間帯の切り替わり。
 * 夜に切り替えたら夜の終わりまで（昼のうちなら、次の夜の終わりまで）、昼に切り替えたら次の夜の始まりまで。
 * 夜の時間帯が無い（または切り替わりが見つからない）ときは24時間後
 */
export function nextPeriodSwitch(
  now: Date,
  target: ParallelPeriod,
  hours: NightHours | null,
  timeZone: string = DEFAULT_PARALLEL_TZ,
): Date {
  const fallback = new Date(now.getTime() + DAY_MS);
  if (!hours) return fallback;
  const minuteStart = Math.floor(now.getTime() / 60_000) * 60_000;
  let t = minuteStart - minuteInZone(now, timeZone) * 60_000 + HOUR_MS;
  let prevNight = isNightHour(hourInZone(now, timeZone), hours);
  for (let i = 0; i < 26; i += 1) {
    const at = new Date(t);
    const night = isNightHour(hourInZone(at, timeZone), hours);
    if (target === "night" ? prevNight && !night : !prevNight && night) return at;
    prevNight = night;
    t += HOUR_MS;
  }
  return fallback;
}

/** 上書きを入れた、いまの状態 */
export type ParallelState = {
  period: ParallelPeriod;
  limit: number;
  /** いま効いている上書き。無ければ null（時間帯の決まりのとおり） */
  override: ParallelOverride | null;
};

/** いまの状態を決める。効いている上書きがあれば、それが時間帯の決まりに勝つ */
export function resolveParallelState(
  now: Date,
  settings: ParallelSettings,
  overrideValue: string | null | undefined,
  timeZone: string = DEFAULT_PARALLEL_TZ,
): ParallelState {
  const override = activeParallelOverride(overrideValue, now);
  const period = override?.period ?? currentPeriod(now, settings.nightHours, timeZone);
  return { period, limit: period === "night" ? settings.night : settings.day, override };
}

/** 別タブへ保存した設定を知らせる BroadcastChannel の名前 */
export const PARALLEL_SETTINGS_CHANNEL = "agent-desk:parallel-settings";

/** 読み込んだ設定と手の上書き（画面が持つ状態） */
export type ParallelSnapshotLike = { settings: ParallelSettings; override: string | null };

/** 保存した設定を状態に入れる。手の上書きはそのまま残す（効いていれば上書きが勝つ） */
export function applySavedParallelSettings(
  snapshot: ParallelSnapshotLike | null,
  saved: ParallelSettings,
): ParallelSnapshotLike {
  return { settings: saved, override: snapshot?.override ?? null };
}

/** 別タブから届いた値を確かめる。設定として正しくなければ null（無視する） */
export function parseSavedParallelMessage(data: unknown): ParallelSettings | null {
  const checked = checkParallelSettings(data);
  return checked.ok ? checked.settings : null;
}

/** 保存した設定のとき、左のバー・メニューに出る文言（今が昼なら昼の数、夜なら夜の数。上書きが効いていればその上限） */
export function describeParallelBarAfterSave(
  now: Date,
  snapshot: ParallelSnapshotLike | null,
  saved: ParallelSettings,
  timeZone: string = DEFAULT_PARALLEL_TZ,
): string {
  const next = applySavedParallelSettings(snapshot, saved);
  return describeParallelBar(resolveParallelState(now, next.settings, next.override, timeZone));
}

/** 押したときの変更：上書きを書く（`set`）か、消して時間帯の決まりに戻す（`clear`） */
export type ParallelToggle =
  | { mode: "set"; override: ParallelOverride }
  | { mode: "clear" };

/** 帯のボタンを押したときの変更。上書き中なら消す。そうでなければ、決まりの反対側へ、次の切り替わりまで */
export function planParallelToggle(
  now: Date,
  settings: ParallelSettings,
  overrideValue: string | null | undefined,
  timeZone: string = DEFAULT_PARALLEL_TZ,
): ParallelToggle {
  if (activeParallelOverride(overrideValue, now)) return { mode: "clear" };
  const scheduled = currentPeriod(now, settings.nightHours, timeZone);
  const period: ParallelPeriod = scheduled === "night" ? "day" : "night";
  return {
    mode: "set",
    override: { period, until: nextPeriodSwitch(now, period, settings.nightHours, timeZone) },
  };
}

/** スイッチの横に出す今の数：`3件まで`（オン＝昼の数）・`1件ずつ`（オフ＝夜の数が1）・`2件まで`（夜の数が2以上） */
export function describeParallelBar(state: ParallelState): string {
  return state.period === "night" && state.limit === 1 ? "1件ずつ" : `${state.limit}件まで`;
}

/** 読み上げ・title 用の今の状態：`並列3`（昼）・`夜：1件ずつ`（夜。2以上なら `夜：並列2`） */
function describeParallelStatus(state: ParallelState): string {
  if (state.period === "day") return `並列${state.limit}`;
  return state.limit === 1 ? "夜：1件ずつ" : `夜：並列${state.limit}`;
}

/** 上書きの期限を、基準のタイムゾーンの `11/18 08:00` にする（ボタンの説明用） */
export function formatOverrideUntil(until: Date, timeZone: string = DEFAULT_PARALLEL_TZ): string {
  function format(zone: string): string {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(until);
    const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
    return `${get("month")}/${get("day")} ${get("hour")}:${get("minute")}`;
  }
  try {
    return format(timeZone);
  } catch {
    return format(DEFAULT_PARALLEL_TZ);
  }
}

/** ボタンの読み上げ・title：いまの状態と、押すとどうなるか */
export function describeParallelButton(state: ParallelState, timeZone: string = DEFAULT_PARALLEL_TZ): string {
  const now = describeParallelStatus(state);
  if (state.override) {
    return `${now}（手動で切り替え中。${formatOverrideUntil(state.override.until, timeZone)} まで）。押すと時間帯の決まりに戻す`;
  }
  return `${now}。押すと${state.period === "day" ? "夜" : "昼"}に切り替える（次の時間帯の切り替わりまで）`;
}

/** 節に出す、今の状態の一文 */
export function describeParallelNow(
  now: Date,
  settings: ParallelSettings,
  timeZone: string = DEFAULT_PARALLEL_TZ,
): string {
  if (!settings.nightHours) return "夜の時間帯はありません";
  const limit = currentParallelLimit(now, settings, timeZone);
  const text = limit === 1 ? "1件ずつ" : `並列${limit}`;
  return `いまは${currentPeriod(now, settings.nightHours, timeZone) === "night" ? "夜" : "昼"}：${text}`;
}
