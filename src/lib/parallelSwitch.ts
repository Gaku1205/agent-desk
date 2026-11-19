/**
 * 左のバーの「同時に動かす」の決まり（純粋関数だけ）。
 * 今の状態（札・数・マス・文）と、3択（自動・夜の数・昼の数）の書き方を決める。
 * docs/spec.md の「並列の状態と切り替え」・docs/design.md の「同時に動かす」
 */
import { DEFAULT_PARALLEL_TZ, hourInZone, type ParallelSettings, type ParallelState } from "./parallel";

/** 3択：自動（上書きを消す）・夜の数（`night` の上書き）・昼の数（`day` の上書き） */
export type ParallelChoice = "auto" | "night" | "day";

/** Server Action `setParallelOverride` に渡す値 */
export function parallelChoiceValue(choice: ParallelChoice): "clear" | "night" | "day" {
  return choice === "auto" ? "clear" : choice;
}

/** 3択のうち、いま選ばれている物。上書きが効いていればその時間帯、無ければ自動 */
export function selectedParallelChoice(state: ParallelState): ParallelChoice {
  return state.override ? state.override.period : "auto";
}

/** 3択の文字：`自動`・`1件`（夜の数）・`5件`（昼の数） */
export function parallelChoiceLabel(choice: ParallelChoice, settings: ParallelSettings): string {
  if (choice === "auto") return "自動";
  return `${choice === "night" ? settings.night : settings.day}件`;
}

/** 札：`自動 · 昼`・`自動 · 夜`・`手動` */
export function parallelBadge(state: ParallelState): string {
  if (state.override) return "手動";
  return state.period === "night" ? "自動 · 夜" : "自動 · 昼";
}

/** マス1つの状態：使っている席・空いている席・その時間は使えない席 */
export type ParallelCell = "used" | "free" | "unavailable";

/**
 * 席のマス。数は、昼の上限・今の上限・使用中の数のうち大きい物
 * （昼の上限ぶんが基本で、夜の上限を超える分は使えない席）。使っている席を先頭から詰める
 */
export function parallelCells(inUse: number | null, settings: ParallelSettings, state: ParallelState): ParallelCell[] {
  const total = Math.max(settings.day, state.limit, inUse ?? 0);
  const used = Math.min(inUse ?? 0, total);
  return Array.from({ length: total }, (_, index): ParallelCell => {
    if (index < used) return "used";
    return index < state.limit ? "free" : "unavailable";
  });
}

/** `3件まで`・`1件ずつ`（夜の数が1のとき） */
export function parallelCountText(n: number, night: boolean): string {
  return night && n === 1 ? "1件ずつ" : `${n}件まで`;
}

/** `7:00`（時は0を付けない） */
function clock(hour: number, minute: number): string {
  return `${hour % 24}:${String(minute).padStart(2, "0")}`;
}

/** 基準のタイムゾーンの `7:00`。タイムゾーンが不正なら既定 */
export function formatClock(at: Date, timeZone: string = DEFAULT_PARALLEL_TZ): string {
  function minuteIn(zone: string): number {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, minute: "numeric" }).formatToParts(at);
    return Number(parts.find((part) => part.type === "minute")?.value) || 0;
  }
  let minute: number;
  try {
    minute = minuteIn(timeZone);
  } catch {
    minute = minuteIn(DEFAULT_PARALLEL_TZ);
  }
  return clock(hourInZone(at, timeZone), minute);
}

/**
 * 次に変わる時刻の文。自動の夜は `7:00 から 5件`（夜の終わりから昼の数）、自動の昼は `23:00 から 1件ずつ`（夜の始まりから夜の数）、
 * 手動は `7:00 に自動へ戻る`。夜の時間帯が無い自動は null（出さない）
 */
export function describeNextParallelChange(
  state: ParallelState,
  settings: ParallelSettings,
  timeZone: string = DEFAULT_PARALLEL_TZ,
): string | null {
  if (state.override) return `${formatClock(state.override.until, timeZone)} に自動へ戻る`;
  if (!settings.nightHours) return null;
  const { start, end } = settings.nightHours;
  if (state.period === "night") return `${clock(end, 0)} から ${settings.day}件`;
  return `${clock(start, 0)} から ${parallelCountText(settings.night, true)}`;
}

/** 4行目：`1 / 1 使用中 · 7:00 から 5件`。使用中の数がまだ分からないときは `–` */
export function describeParallelUsage(
  inUse: number | null,
  state: ParallelState,
  settings: ParallelSettings,
  timeZone: string = DEFAULT_PARALLEL_TZ,
): string {
  const head = `${inUse ?? "–"} / ${state.limit} 使用中`;
  const next = describeNextParallelChange(state, settings, timeZone);
  return next ? `${head} · ${next}` : head;
}

/** 畳んだときの1行の読み上げ・title：`同時に動かす：1件まで（自動 · 夜）。1 / 1 使用中` */
export function describeParallelFolded(inUse: number | null, state: ParallelState): string {
  return `同時に動かす：${state.limit}件まで（${parallelBadge(state)}）。${inUse ?? "–"} / ${state.limit} 使用中`;
}
