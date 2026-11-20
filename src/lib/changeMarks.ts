import type { WatchedRepo } from "./config";

// 画面が見る「変わった」印（docs/spec.md の「更新」）。ブラウザでも使うので、サーバーだけの物は import しない

/** 画面が「変わった」印を見に行く間隔の基本（サーバーの CPU を使い切らないため15秒。AIの番の作業があるときと同じ） */
export const CHANGES_POLL_INTERVAL_MS = 15_000;
/** AIの番の作業がある間の、印を見に行く間隔（15秒） */
export const CHANGES_POLL_BUSY_INTERVAL_MS = 15_000;
/** AIの番の作業が無い間の、印を見に行く間隔（60秒。待っているだけの呼び出しを減らすため） */
export const CHANGES_POLL_IDLE_INTERVAL_MS = 60_000;

/** 印を見に行く間隔：AIの番の作業があれば15秒、無ければ60秒 */
export function changesPollIntervalMs(busy: boolean): number {
  return busy ? CHANGES_POLL_BUSY_INTERVAL_MS : CHANGES_POLL_IDLE_INTERVAL_MS;
}

/** `/api/changes` で、監視しているリポジトリ（`watched`）に含まれる物だけを残す（大文字小文字は区別しない） */
export function filterWatchedRepos(requested: WatchedRepo[], watched: WatchedRepo[]): WatchedRepo[] {
  const allowed = new Set(watched.map(repoChangeKey));
  return requested.filter((repo) => allowed.has(repoChangeKey(repo)));
}

/** 変化による作り直しの最短の間隔（Your turn に入る急ぎの変化は除く） */
export const CHANGE_REFRESH_MIN_INTERVAL_MS = 60_000;

/** 急ぎの印を、画面の中で通常の印と同じ入れ物に入れるときのキーの頭（`/api/changes` の返事の `urgent`） */
export const URGENT_MARK_PREFIX = "!urgent:";

/** `/api/changes` の返事の `urgent`（リポジトリごとの「最後に急ぎの知らせが来た時刻」）を、印の入れ物に混ぜる */
export function mergeUrgentMarks(changes: ChangeMarks, urgent: unknown): ChangeMarks {
  if (typeof urgent !== "object" || urgent === null || Array.isArray(urgent)) return changes;
  const merged: ChangeMarks = { ...changes };
  for (const [key, at] of Object.entries(urgent)) {
    if (typeof at === "string") merged[`${URGENT_MARK_PREFIX}${key}`] = at;
  }
  return merged;
}

/** 印のうち、急ぎの印を除いた物 */
function plainMarks(marks: ChangeMarks): [string, string][] {
  return Object.entries(marks).filter(([key]) => !key.startsWith(URGENT_MARK_PREFIX));
}

/**
 * 取り直す変化に、急ぎの知らせ（Your turn に入りうる物）が含まれるか：
 * 印が反映済みより新しいリポジトリで、急ぎの知らせの時刻も反映済みの印より新しい
 */
export function hasUrgentChange(applied: ChangeMarks, marks: ChangeMarks): boolean {
  return plainMarks(marks).some(([key, at]) => {
    const urgentAt = marks[`${URGENT_MARK_PREFIX}${key}`];
    if (urgentAt === undefined) return false;
    const appliedAt = applied[key];
    if (appliedAt === undefined || !isBehindChangeMarks({ [key]: appliedAt }, { [key]: at })) return false;
    const appliedMs = Date.parse(appliedAt);
    const urgentMs = Date.parse(urgentAt);
    return !Number.isNaN(urgentMs) && urgentMs > appliedMs;
  });
}

/**
 * 変化による作り直しを、今してよいか。急ぎの変化はいつでもよい。そうでなければ、前の作り直しから60秒たっているとき
 * （前の時刻が時計より先なら、時計が戻ったとみなしてよい）
 */
export function mayRefreshForChange(input: { lastAt: number | null; now: number; urgent: boolean }): boolean {
  const { lastAt, now, urgent } = input;
  if (urgent || lastAt === null || now < lastAt) return true;
  return now - lastAt >= CHANGE_REFRESH_MIN_INTERVAL_MS;
}

/** 監視リポジトリごとの「最後に変わった時刻」（キーは `owner/repo` の小文字、値は ISO 文字列） */
export type ChangeMarks = Record<string, string>;

/** `owner/repo`（小文字）。「変わった」印のキー */
export function repoChangeKey({ owner, repo }: WatchedRepo): string {
  return `${owner}/${repo}`.toLowerCase();
}

/** `/api/changes` の返事の `changes` を読む。形が違うときは null */
export function parseChangeMarks(value: unknown): ChangeMarks | null {
  if (typeof value !== "object" || value === null) return null;
  const changes = (value as { changes?: unknown }).changes;
  if (typeof changes !== "object" || changes === null || Array.isArray(changes)) return null;
  const marks: ChangeMarks = {};
  for (const [key, at] of Object.entries(changes)) {
    if (typeof at !== "string") return null;
    marks[key] = at;
  }
  return marks;
}

/**
 * サーバーの印が、画面のデータに反映済みの印より新しいリポジトリがあるか（あれば取り直す）。
 * 反映済みの印が無い・読めないリポジトリは比べない（取り直し続けないため）
 */
export function isBehindChangeMarks(applied: ChangeMarks, marks: ChangeMarks): boolean {
  return plainMarks(marks).some(([key, at]) => {
    const appliedAt = applied[key];
    if (appliedAt === undefined) return false;
    const markMs = Date.parse(at);
    const appliedMs = Date.parse(appliedAt);
    if (Number.isNaN(markMs) || Number.isNaN(appliedMs)) return false;
    return markMs > appliedMs;
  });
}

/** 取り直しを頼んでから、その結果（新しい反映済みの印）を待つ上限。過ぎたら、もう一度頼んでよい */
export const CHANGE_REFRESH_WAIT_MS = 10_000;

/**
 * 印が新しいと分かったとき、取り直しを頼むか。前に頼んだ取り直しの結果がまだ届いていない間
 * （頼んでから10秒以内）は、重ねて頼まない（同じ取り直しを何度も始めないため）
 */
export function shouldRequestRefresh(input: {
  /** 前に取り直しを頼んだ時刻（ミリ秒）。頼んでいない・結果が届いたなら null */
  requestedAt: number | null;
  now: number;
}): boolean {
  const { requestedAt, now } = input;
  return requestedAt === null || now - requestedAt >= CHANGE_REFRESH_WAIT_MS || now < requestedAt;
}

/** 「変わった」印を見る方法。`/api/changes` の返事を印にする。404 は "unavailable"（Webhook を使わない設定）、ほかの失敗は null */
export type ChangeMarksResult = ChangeMarks | "unavailable" | null;

/** 自動更新が「変わった」印を見る間のタブの情報 */
export type ChangesVisibilitySource = {
  readonly hidden: boolean;
  addEventListener(type: "visibilitychange", listener: () => void): void;
  removeEventListener(type: "visibilitychange", listener: () => void): void;
};

/**
 * タブが見えている間、`intervalMs` ごとに `load` で印を見て、画面のデータに反映済みの印（`getApplied`。
 * 呼ぶたびに最新の物を返す）より新しいリポジトリがあるときだけ `refresh` を呼ぶ。
 * 比べる元は見張りの外（画面）が持つので、見張りを作り直しても取りこぼさない。
 * `load` が "unavailable" を返したら、見るのをやめて `onUnavailable` を呼ぶ（今までどおりの間隔の取り直しに戻す）。
 * 非表示から戻ったときもすぐ1回見る。戻り値は止める関数
 */
export function startChangeWatch(options: {
  load: () => Promise<ChangeMarksResult>;
  getApplied: () => ChangeMarks;
  /** 取り直しを頼む。急ぎの変化（Your turn に入りうる）かどうかを渡す */
  refresh: (urgent: boolean) => void;
  onUnavailable: () => void;
  source: ChangesVisibilitySource;
  intervalMs?: number;
}): () => void {
  const { load, getApplied, refresh, onUnavailable, source, intervalMs = CHANGES_POLL_INTERVAL_MS } = options;
  let timer: ReturnType<typeof setInterval> | null = null;
  let stopped = false;
  let loading = false;

  const check = async () => {
    // 隠れているタブでは聞かない
    if (loading || source.hidden) return;
    loading = true;
    let result: ChangeMarksResult;
    try {
      result = await load();
    } catch {
      result = null;
    } finally {
      loading = false;
    }
    // 返事を待つ間に隠れたなら、作り直さない（見えるようになったら1回聞く）
    if (stopped || source.hidden) return;
    if (result === "unavailable") {
      dispose();
      onUnavailable();
      return;
    }
    if (result === null) return;
    const applied = getApplied();
    if (isBehindChangeMarks(applied, result)) refresh(hasUrgentChange(applied, result));
  };
  const stopTimer = () => {
    if (timer === null) return;
    clearInterval(timer);
    timer = null;
  };
  const startTimer = () => {
    stopTimer();
    timer = setInterval(() => void check(), intervalMs);
  };
  const onVisibilityChange = () => {
    if (source.hidden) {
      stopTimer();
    } else {
      void check();
      startTimer();
    }
  };
  const dispose = () => {
    stopped = true;
    stopTimer();
    source.removeEventListener("visibilitychange", onVisibilityChange);
  };

  // 最初の1回もすぐ見る（表示の後に来た変化を待たずに出すため）
  void check();
  if (!source.hidden) startTimer();
  source.addEventListener("visibilitychange", onVisibilityChange);
  return dispose;
}
