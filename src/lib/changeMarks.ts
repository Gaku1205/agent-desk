import type { WatchedRepo } from "./config";

// 画面が見る「変わった」印（docs/spec.md の「更新」）。ブラウザでも使うので、サーバーだけの物は import しない

/** 画面が「変わった」印を見に行く間隔 */
export const CHANGES_POLL_INTERVAL_MS = 5_000;
/** AIの番の作業がある間の、印を見に行く間隔（動いている間は早く出す。GitHub には問い合わせない） */
export const CHANGES_POLL_BUSY_INTERVAL_MS = 2_500;

/** 印を見に行く間隔：AIの番の作業がある間（速い更新の間）は2.5秒、無ければ5秒 */
export function changesPollIntervalMs(busy: boolean): number {
  return busy ? CHANGES_POLL_BUSY_INTERVAL_MS : CHANGES_POLL_INTERVAL_MS;
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
  return Object.entries(marks).some(([key, at]) => {
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
  refresh: () => void;
  onUnavailable: () => void;
  source: ChangesVisibilitySource;
  intervalMs?: number;
}): () => void {
  const { load, getApplied, refresh, onUnavailable, source, intervalMs = CHANGES_POLL_INTERVAL_MS } = options;
  let timer: ReturnType<typeof setInterval> | null = null;
  let stopped = false;
  let loading = false;

  const check = async () => {
    if (loading) return;
    loading = true;
    let result: ChangeMarksResult;
    try {
      result = await load();
    } catch {
      result = null;
    } finally {
      loading = false;
    }
    if (stopped) return;
    if (result === "unavailable") {
      dispose();
      onUnavailable();
      return;
    }
    if (result === null) return;
    if (isBehindChangeMarks(getApplied(), result)) refresh();
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
