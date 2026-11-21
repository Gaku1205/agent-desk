/** 長い題名を流す（触れた行だけ。docs/design.md の「長い題名を流す」）。DOM を触らない純粋な関数 */

/** 流す速さ（px/秒） */
export const MARQUEE_SPEED = 60;
/** 最初と最後で止まる時間（ミリ秒） */
export const MARQUEE_PAUSE_MS = 1000;
/** 長押しと見なす長さ（ミリ秒） */
export const LONG_PRESS_MS = 400;
/** 長押しのあとの「押した」を無かったことにする間（ミリ秒） */
export const CLICK_SUPPRESS_MS = 400;

/** 中身が箱からはみ出して切れているか（小数点以下の誤差は無視する） */
export function isOverflowing(contentSize: number, boxSize: number, tolerance = 1): boolean {
  return contentSize - boxSize > tolerance;
}

/** 題名の最後が見えるまで左へ動かす長さ（px）。はみ出していなければ 0 */
export function marqueeDistance(contentWidth: number, boxWidth: number): number {
  return Math.max(0, Math.ceil(contentWidth - boxWidth));
}

export type MarqueeTiming = {
  /** 1周の長さ（最初の止まり＋流れ＋最後の止まり）。ミリ秒 */
  durationMs: number;
  /** 流れ始める位置（0〜1。1周のうちの割合） */
  startOffset: number;
  /** 流れ終わる位置（0〜1） */
  endOffset: number;
};

/** 流す時間。流れる長さに比例して延びる。流れる長さが 0 以下なら null（流さない） */
export function marqueeTiming(
  distance: number,
  speed: number = MARQUEE_SPEED,
  pauseMs: number = MARQUEE_PAUSE_MS,
): MarqueeTiming | null {
  if (!(distance > 0) || !(speed > 0)) return null;
  const travelMs = (distance / speed) * 1000;
  const durationMs = pauseMs * 2 + travelMs;
  return { durationMs, startOffset: pauseMs / durationMs, endOffset: (pauseMs + travelMs) / durationMs };
}

export type LongPress = {
  /** 触れ始めた */
  start: () => void;
  /** 動いた・外れたなどで長押しをやめる（押したことにはしない） */
  cancel: () => void;
  /** 離した。長押しで流していたなら true */
  end: () => boolean;
  /** 離したあとに来る「押した」を無かったことにするか（1回だけ true） */
  consumeClick: () => boolean;
};

type LongPressOptions = {
  onLong: () => void;
  delayMs?: number;
  suppressMs?: number;
  now?: () => number;
};

/**
 * 長押し：触れてから `delayMs` たつと `onLong`。長押しのあと離したら、直後の「押した」は無かったことにする。
 * 短く触れたときは何も起きず、「押した」は今までどおり通る
 */
export function createLongPress({
  onLong,
  delayMs = LONG_PRESS_MS,
  suppressMs = CLICK_SUPPRESS_MS,
  now = Date.now,
}: LongPressOptions): LongPress {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let fired = false;
  let suppressUntil = 0;

  function clear() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  return {
    start() {
      clear();
      fired = false;
      timer = setTimeout(() => {
        timer = null;
        fired = true;
        onLong();
      }, delayMs);
    },
    cancel() {
      clear();
      fired = false;
    },
    end() {
      clear();
      if (!fired) return false;
      fired = false;
      suppressUntil = now() + suppressMs;
      return true;
    },
    consumeClick() {
      if (suppressUntil === 0) return false;
      const suppress = now() < suppressUntil;
      suppressUntil = 0;
      return suppress;
    },
  };
}
