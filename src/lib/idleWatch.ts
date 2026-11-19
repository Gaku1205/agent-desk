// 操作が無いタブの自動更新を止める（docs/spec.md の「更新」の「サーバーの CPU の予算」）。ブラウザでも使う

/** この時間、操作が無いタブは、自動の作り直しを止める */
export const IDLE_LIMIT_MS = 30 * 60_000;
/** 操作が無かった時間を調べる間隔 */
export const IDLE_CHECK_MS = 30_000;

/** 操作を知らせるイベントを受け取れる物（`window`・`document`） */
export type ActivitySource = {
  addEventListener(type: string, listener: () => void, options?: AddEventListenerOptions): void;
  removeEventListener(type: string, listener: () => void): void;
};

/** 操作とみなすイベント */
export const ACTIVITY_EVENTS = ["pointerdown", "keydown", "wheel", "touchstart", "scroll"] as const;

/** 最後の操作から `limitMs` 以上たったか（時計が戻ったときは、たっていないとみなす） */
export function isIdle(lastActiveAt: number, now: number, limitMs: number = IDLE_LIMIT_MS): boolean {
  return now >= lastActiveAt && now - lastActiveAt >= limitMs;
}

/**
 * 操作（`ACTIVITY_EVENTS`）を見て、`limitMs` 操作が無ければ `onIdle` を1回呼んで見るのをやめる
 * （止めた後は、操作では再開しない。「最新にする」の帯を押したときに、呼ぶ側がもう一度始める）。戻り値は止める関数
 */
export function startIdleWatch(options: {
  source: ActivitySource;
  onIdle: () => void;
  now?: () => number;
  limitMs?: number;
  checkMs?: number;
}): () => void {
  const { source, onIdle, now = Date.now, limitMs = IDLE_LIMIT_MS, checkMs = IDLE_CHECK_MS } = options;
  let lastActiveAt = now();

  const onActivity = () => {
    lastActiveAt = now();
  };
  const stop = () => {
    clearInterval(timer);
    for (const type of ACTIVITY_EVENTS) source.removeEventListener(type, onActivity);
  };
  const timer = setInterval(() => {
    if (!isIdle(lastActiveAt, now(), limitMs)) return;
    stop();
    onIdle();
  }, checkMs);
  for (const type of ACTIVITY_EVENTS) source.addEventListener(type, onActivity, { passive: true });
  return stop;
}
