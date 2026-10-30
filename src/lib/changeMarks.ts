import type { WatchedRepo } from "./config";

// 画面が見る「変わった」印（docs/spec.md の「更新」）。ブラウザでも使うので、サーバーだけの物は import しない

/** 画面が「変わった」印を見に行く間隔 */
export const CHANGES_POLL_INTERVAL_MS = 5_000;

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
 * 前に見た印と比べて、変わったリポジトリがあるか。前が無い（初めて見た）ときは変わっていない扱い。
 * 片方にしか無いリポジトリも変わった扱い
 */
export function hasChangedRepo(previous: ChangeMarks | null, next: ChangeMarks): boolean {
  if (previous === null) return false;
  const keys = new Set([...Object.keys(previous), ...Object.keys(next)]);
  for (const key of keys) {
    if (previous[key] !== next[key]) return true;
  }
  return false;
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
 * タブが見えている間、`intervalMs` ごとに `load` で印を見て、前と違うリポジトリがあるときだけ `refresh` を呼ぶ。
 * `load` が "unavailable" を返したら、見るのをやめて `onUnavailable` を呼ぶ（今までどおりの間隔の取り直しに戻す）。
 * 非表示から戻ったときもすぐ1回見る。戻り値は止める関数
 */
export function startChangeWatch(options: {
  load: () => Promise<ChangeMarksResult>;
  refresh: () => void;
  onUnavailable: () => void;
  source: ChangesVisibilitySource;
  intervalMs?: number;
}): () => void {
  const { load, refresh, onUnavailable, source, intervalMs = CHANGES_POLL_INTERVAL_MS } = options;
  let timer: ReturnType<typeof setInterval> | null = null;
  let previous: ChangeMarks | null = null;
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
    const changed = hasChangedRepo(previous, result);
    previous = result;
    if (changed) refresh();
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

  // 最初の1回は、比べる元の印を覚えるため
  void check();
  if (!source.hidden) startTimer();
  source.addEventListener("visibilitychange", onVisibilityChange);
  return dispose;
}
