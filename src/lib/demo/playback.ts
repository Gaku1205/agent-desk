/** デモの「再生」：サンプルの1件（メモから始めた物）を、4秒ごとに次の段階へ進める */

/** 次の段階へ進む間隔 */
export const PLAY_INTERVAL_MS = 4000;

/** 再生で通る段階（順番どおり）。`verifying` は修正の確認中、それ以外は spec.md の段階 */
export const PLAY_STEPS = [
  "planning",
  "implementing",
  "prWaiting",
  "ciRunning",
  "reviewing",
  "fixing",
  "verifying",
  "mergeWaiting",
  "deploying",
  "deployed",
] as const;

export type PlayStep = (typeof PLAY_STEPS)[number];

export type DemoPlayback = {
  /** 今の段階（PLAY_STEPS の番号） */
  step: number;
  /** デモの「今」（ISO文字列）。1段階進むごとに4秒進む */
  now: string;
  /** 各段階に入った時刻（ISO文字列、PLAY_STEPS の番号ごと） */
  times: string[];
};

const MINUTE_MS = 60 * 1000;

/** 再生前の状態：企画AIが2分前から清書中 */
export function startPlayback(now: Date): DemoPlayback {
  return {
    step: 0,
    now: now.toISOString(),
    times: [new Date(now.getTime() - 2 * MINUTE_MS).toISOString()],
  };
}

export function playStep(playback: DemoPlayback): PlayStep {
  return PLAY_STEPS[Math.min(Math.max(0, playback.step), PLAY_STEPS.length - 1)];
}

/** 最後の段階（公開済み）まで行ったか */
export function isPlaybackDone(playback: DemoPlayback): boolean {
  return playback.step >= PLAY_STEPS.length - 1;
}

/** 次の段階へ進める（最後まで行っていたら、そのまま） */
export function advancePlayback(playback: DemoPlayback): DemoPlayback {
  if (isPlaybackDone(playback)) return playback;
  const now = new Date(Date.parse(playback.now) + PLAY_INTERVAL_MS).toISOString();
  return { step: playback.step + 1, now, times: [...playback.times, now] };
}

/** 「もう一度」：今の時刻のまま、最初の段階に戻す */
export function restartPlayback(playback: DemoPlayback): DemoPlayback {
  return startPlayback(new Date(playback.now));
}

export type PlayButtonState = "idle" | "playing" | "done";

/** 帯の再生ボタンの文字（docs/design.md の「デモの帯」） */
export const PLAY_BUTTON_LABEL: Record<PlayButtonState, string> = {
  idle: "再生 ▶",
  playing: "再生中…",
  done: "もう一度 ↺",
};
