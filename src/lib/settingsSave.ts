/**
 * 設定の画面の「変えたらすぐ保存」（docs/spec.md の「設定の操作の決まり」）。
 * 変えた1項目から、どの Variable にどの値を書くか、止まってから保存する判定、失敗で戻す判定を決める純粋関数
 */
import { AUTO_ADD_VARIABLE, formatAutoAddEnabled } from "./autoAdd";
import { WATCHED_REPOS_VARIABLE } from "./github/settings";
import {
  NOTIFY_EVENT_KINDS,
  NOTIFY_EVENTS_VARIABLE,
  NOTIFY_MESSAGES,
  formatNotifyEvents,
  type NotifyEvent,
} from "./notifyEvents";
import {
  buildParallelWrites,
  checkParallelSettings,
  DEFAULT_PARALLEL_TZ,
  PARALLEL_MESSAGES,
  PARALLEL_SELECT_MAX,
  type NightHours,
  type ParallelSettings,
  type ParallelWrite,
} from "./parallel";
import { REPO_SETTING_MESSAGES } from "./repoSetting";

/** 段階ボタン・帯は、最後に押してからこの長さ止まったら保存する */
export const SAVE_DELAY_MS = 600;

/* ───────── どの値をどこに書くか ───────── */

export type PlanResult<T> = { ok: true; write: T } | { ok: false; message: string };

/** `SETTINGS_REPO` の Variable 1つに書く */
export type SettingsRepoWrite = { where: "settingsRepo"; variable: string; value: string };

/** 監視するリポジトリ（外す・追加）→ `AGENT_DESK_WATCHED_REPOS`。0件は書かない */
export function planWatchedReposWrite(names: readonly string[]): PlanResult<SettingsRepoWrite & { names: string[] }> {
  if (names.length === 0) return { ok: false, message: REPO_SETTING_MESSAGES.empty };
  return {
    ok: true,
    write: { where: "settingsRepo", variable: WATCHED_REPOS_VARIABLE, value: names.join(","), names: [...names] },
  };
}

/** `Auto-add` のスイッチ → `AGENT_DESK_AUTO_ADD` に `on` / `off` */
export function planAutoAddWrite(on: boolean): PlanResult<SettingsRepoWrite & { on: boolean }> {
  return {
    ok: true,
    write: { where: "settingsRepo", variable: AUTO_ADD_VARIABLE, value: formatAutoAddEnabled(on), on },
  };
}

/** 並列 → パイプラインのある監視リポジトリ全部の `PARALLEL_DAY`・`PARALLEL_NIGHT`・`PARALLEL_NIGHT_HOURS`（null は消す） */
export function planParallelWrite(
  settings: ParallelSettings,
): PlanResult<{ where: "pipelineRepos"; writes: ParallelWrite[]; settings: ParallelSettings }> {
  const checked = checkParallelSettings(settings);
  if (!checked.ok) return checked;
  return {
    ok: true,
    write: { where: "pipelineRepos", writes: buildParallelWrites(checked.settings), settings: checked.settings },
  };
}

/* ───────── 通知（1行1種類） ───────── */

export type NotifyRowKey = "stuck" | "question" | "merge" | "deploy_failed" | "deployed" | "merged" | "ci_failed";

export type NotifyRowDef = {
  key: NotifyRowKey;
  /** 画面の名前（英語） */
  name: string;
  /** 説明（日本語） */
  description: string;
  /** この行が切り替える `notify.sh` の種類 */
  events: readonly NotifyEvent[];
};

/** 通知の行（この順に出す）。`Merge` は ai:hold のマージ待ちと、トークンが無いときの人間の操作待ちをまとめる */
export const NOTIFY_ROWS: readonly NotifyRowDef[] = [
  { key: "stuck", name: "Stuck", description: "止まって、確認が必要なとき", events: ["stuck"] },
  { key: "question", name: "Question", description: "企画AIから質問があるとき", events: ["question"] },
  {
    key: "merge",
    name: "Merge",
    description: "マージを押せる・PR作成などを人間がするとき",
    events: ["hold", "manual"],
  },
  { key: "deploy_failed", name: "Deploy failed", description: "公開に失敗したとき", events: ["deploy_failed"] },
  { key: "deployed", name: "Deployed", description: "本番に公開されたとき", events: ["deployed"] },
  { key: "merged", name: "Auto-merged", description: "AIがPRをマージしたとき", events: ["merged"] },
  { key: "ci_failed", name: "CI failed", description: "CI（自動のチェック）が失敗したとき（AIが直す前）", events: ["ci_failed"] },
];

/** 1つのリポジトリの通知の状態 */
export type NotifyRepo = {
  /** `owner/repo` */
  name: string;
  /** パイプラインがあるか。無ければ対象外（書かない・数えない） */
  pipeline: boolean;
  events: readonly NotifyEvent[];
};

function rowOf(key: NotifyRowKey): NotifyRowDef {
  const row = NOTIFY_ROWS.find((item) => item.key === key);
  if (!row) throw new Error(`知らない通知の行：${key}`);
  return row;
}

/** その行の種類を、そのリポジトリで鳴らすか（`Merge` は片方でも入っていれば鳴らす） */
export function repoHasRow(repo: NotifyRepo, key: NotifyRowKey): boolean {
  return rowOf(key).events.some((event) => repo.events.includes(event));
}

/** 決まった並びにそろえる */
function ordered(events: Iterable<NotifyEvent>): NotifyEvent[] {
  const set = new Set(events);
  return NOTIFY_EVENT_KINDS.filter((kind) => set.has(kind));
}

function withRow(events: readonly NotifyEvent[], key: NotifyRowKey, on: boolean): NotifyEvent[] {
  const row = rowOf(key).events;
  return on ? ordered([...events, ...row]) : ordered(events.filter((event) => !row.includes(event)));
}

/** 行のまとめ：鳴らすリポジトリの数 / パイプラインのあるリポジトリの数 */
export function notifyRowSummary(repos: readonly NotifyRepo[], key: NotifyRowKey): { on: number; total: number } {
  const targets = repos.filter((repo) => repo.pipeline);
  return { on: targets.filter((repo) => repoHasRow(repo, key)).length, total: targets.length };
}

/** 行のスイッチ：どれか1つでも鳴らしていればオン */
export function notifyRowOn(repos: readonly NotifyRepo[], key: NotifyRowKey): boolean {
  return notifyRowSummary(repos, key).on > 0;
}

/** スイッチの横のボタンの字：全部なら `全部`、一部なら `4 / 12` */
export function notifyScopeLabel(repos: readonly NotifyRepo[], key: NotifyRowKey): string {
  const { on, total } = notifyRowSummary(repos, key);
  return on === total ? "全部" : `${on} / ${total}`;
}

/** 行のスイッチを押した後の状態：オンならパイプラインのある全リポジトリに足し、オフなら全部から外す */
export function setNotifyRow(repos: readonly NotifyRepo[], key: NotifyRowKey, on: boolean): NotifyRepo[] {
  return repos.map((repo) => (repo.pipeline ? { ...repo, events: withRow(repo.events, key, on) } : repo));
}

/** リポジトリの札を押した後の状態：そのリポジトリだけ、その行の種類を足す・外す */
export function setNotifyRepo(
  repos: readonly NotifyRepo[],
  key: NotifyRowKey,
  name: string,
  on: boolean,
): NotifyRepo[] {
  return repos.map((repo) =>
    repo.name === name && repo.pipeline ? { ...repo, events: withRow(repo.events, key, on) } : repo,
  );
}

/** 通知の書き込み1つ：そのリポジトリの `NOTIFY_EVENTS` */
export type NotifyWrite = { where: string; variable: string; value: string; events: NotifyEvent[] };

function sameSet(a: readonly NotifyEvent[], b: readonly NotifyEvent[]): boolean {
  return NOTIFY_EVENT_KINDS.every((kind) => a.includes(kind) === b.includes(kind));
}

/**
 * 変える前と後から、書く物を決める（値が変わったパイプラインのあるリポジトリだけ）。
 * 0種類になるリポジトリがあれば、何も書かない（`notify.sh` は空を初期値と見るため）
 */
export function planNotifyWrites(
  before: readonly NotifyRepo[],
  after: readonly NotifyRepo[],
): PlanResult<NotifyWrite[]> {
  const previous = new Map(before.map((repo) => [repo.name, repo.events]));
  const writes: NotifyWrite[] = [];
  for (const repo of after) {
    if (!repo.pipeline) continue;
    const old = previous.get(repo.name) ?? [];
    if (sameSet(old, repo.events)) continue;
    if (repo.events.length === 0) return { ok: false, message: NOTIFY_MESSAGES.empty };
    const events = ordered(repo.events);
    writes.push({ where: repo.name, variable: NOTIFY_EVENTS_VARIABLE, value: formatNotifyEvents(events), events });
  }
  return { ok: true, write: writes };
}

/** 失敗したリポジトリだけ、変える前の値に戻す */
export function revertNotifyFailures(
  before: readonly NotifyRepo[],
  after: readonly NotifyRepo[],
  failed: readonly string[],
): NotifyRepo[] {
  const previous = new Map(before.map((repo) => [repo.name, repo.events]));
  return after.map((repo) =>
    failed.includes(repo.name) ? { ...repo, events: [...(previous.get(repo.name) ?? repo.events)] } : repo,
  );
}

/* ───────── 止まってから保存する（段階ボタン・帯） ───────── */

/** 保存を待っている値と、保存してよくなる時刻 */
export type PendingSave<T> = { value: T; dueAt: number };

/** 押したとき：前に待っていた値は捨て、最後の値だけを、今から delay 後に保存する */
export function queueSave<T>(value: T, now: number, delay: number = SAVE_DELAY_MS): PendingSave<T> {
  return { value, dueAt: now + delay };
}

/** いま保存してよい値（まだ止まっていなければ null） */
export function dueSave<T>(pending: PendingSave<T> | null, now: number): T | null {
  if (!pending || now < pending.dueAt) return null;
  return pending.value;
}

/** 待った末の値が、保存済みと同じなら書かない */
export function needsParallelSave(saved: ParallelSettings, value: ParallelSettings): boolean {
  return !(
    saved.day === value.day &&
    saved.night === value.night &&
    saved.nightHours?.start === value.nightHours?.start &&
    saved.nightHours?.end === value.nightHours?.end
  );
}

/** 失敗したら保存済みに戻し、成功したら保存した値にする */
export function settleSave<T>(saved: T, attempted: T, ok: boolean): T {
  return ok ? attempted : saved;
}

/* ───────── 並列の段階ボタン・帯 ───────── */

/** 段階ボタン：1〜10（今の値が10より大きければ、増やせず、1つずつ減らせる） */
export function stepCount(value: number, delta: 1 | -1): number {
  if (delta > 0) return value >= PARALLEL_SELECT_MAX ? value : value + 1;
  return value <= 1 ? value : value - 1;
}

/** 段階ボタンが押せるか */
export function canStep(value: number, delta: 1 | -1): boolean {
  return stepCount(value, delta) !== value;
}

export type NightPick =
  | { kind: "anchor"; anchor: number }
  | { kind: "picked"; hours: NightHours }
  | { kind: "error"; message: string };

/**
 * 帯のますを押したとき：1回目は始まりを覚え、2回目でそのますの時刻を終わりにする（終わりは含まない）。
 * 同じますを2回押すのは受け付けない
 */
export function pickNightHour(anchor: number | null, hour: number): NightPick {
  if (anchor === null) return { kind: "anchor", anchor: hour };
  if (anchor === hour) return { kind: "error", message: PARALLEL_MESSAGES.sameHours };
  return { kind: "picked", hours: { start: anchor, end: hour } };
}

/* ───────── 表示の文 ───────── */

/** 見出しの右の保存の状態。まだ保存していなければ `変えたらすぐ保存` だけ */
export function formatSavedAt(savedAt: Date | null, timeZone: string = DEFAULT_PARALLEL_TZ): string | null {
  if (!savedAt) return null;
  const time = new Intl.DateTimeFormat("ja-JP", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(savedAt);
  return `${time} に保存しました`;
}
