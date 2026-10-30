/** 流す文字（電光掲示板）の量と時間（docs/design.md の「流れ」の名札・「出来事」） */

/** 流している行の両端を消す幅（px） */
export const MARQUEE_EDGE = 12;

/** どう流すか：hover＝乗せた・フォーカスしたとき（PC）、view＝画面に見えている間（スマホ） */
export type MarqueeMode = "hover" | "view";

type Plan = {
  /** 流れ出すまで先頭を見せる時間（ms） */
  lead: number;
  /** 末尾が見えてから止まる時間（ms） */
  hold: number;
  /** 速さ（px/秒） */
  speed: number;
};

const PLANS: Record<MarqueeMode, Plan> = {
  hover: { lead: 800, hold: 1200, speed: 40 },
  view: { lead: 2000, hold: 2000, speed: 24 },
};

/** 先頭へフェードして戻る時間（ms。消える半分と、現れる半分） */
export const MARQUEE_FADE = 300;

export type MarqueeFrame = {
  /** 1回の時間に対する位置（0〜1） */
  offset: number;
  /** 左へ動かした距離（px。0以上） */
  shift: number;
  opacity: number;
};

export type MarqueeCycle = {
  /** 1回の時間（ms）。0なら流さない */
  duration: number;
  frames: MarqueeFrame[];
};

/**
 * 流す距離（px）：文字の幅が見える幅に入らなければ、末尾が右端の消す幅の手前に来るまで。
 * 入っている（またはまだ測れていない）なら 0
 */
export function marqueeDistance(textWidth: number, viewWidth: number): number {
  if (!(textWidth > 0) || !(viewWidth > 0) || textWidth <= viewWidth) return 0;
  return Math.ceil(textWidth - viewWidth + MARQUEE_EDGE);
}

/** 流す1回の時間（ms）：待つ → 流れる → 末尾で止まる → 先頭へフェードして戻る */
export function marqueeDuration(distance: number, mode: MarqueeMode): number {
  if (!(distance > 0)) return 0;
  const { lead, hold, speed } = PLANS[mode];
  return Math.round(lead + (distance / speed) * 1000 + hold + MARQUEE_FADE);
}

/** 1回ぶんの動き（Web Animations のキーフレーム）。流さない行は空 */
export function marqueeCycle(distance: number, mode: MarqueeMode): MarqueeCycle {
  const duration = marqueeDuration(distance, mode);
  if (duration === 0) return { duration: 0, frames: [] };
  const { lead, hold, speed } = PLANS[mode];
  const scrollEnd = lead + (distance / speed) * 1000;
  const holdEnd = scrollEnd + hold;
  const half = MARQUEE_FADE / 2;
  const at = (ms: number) => ms / duration;
  return {
    duration,
    frames: [
      { offset: 0, shift: 0, opacity: 1 },
      { offset: at(lead), shift: 0, opacity: 1 },
      { offset: at(scrollEnd), shift: distance, opacity: 1 },
      { offset: at(holdEnd), shift: distance, opacity: 1 },
      { offset: at(holdEnd + half), shift: distance, opacity: 0 },
      { offset: at(holdEnd + half), shift: 0, opacity: 0 },
      { offset: 1, shift: 0, opacity: 1 },
    ],
  };
}
