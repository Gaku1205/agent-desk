// サーバーの各段にかかった時間を、返事の `Server-Timing` ヘッダーにする（docs/spec.md の「サーバーの各段の時間」）。
// 入れるのは段の名前と ms だけ（トークン・リポジトリの名前・データの中身は入れない）。

/** 1つの段：名前（英小文字・数字・`-`）と、かかった時間（ms） */
export type TimingStage = { name: string; ms: number };

/** 段の名前に使える文字だけにする（ヘッダーに入れられない文字を落とす。空になったら `stage`） */
export function timingName(name: string): string {
  const cleaned = name.toLowerCase().replace(/[^a-z0-9-]/g, "");
  return cleaned === "" ? "stage" : cleaned;
}

/** ms を小数1桁にそろえる（負・数でない物は 0） */
export function roundTimingMs(ms: number): number {
  if (!Number.isFinite(ms) || ms < 0) return 0;
  return Math.round(ms * 10) / 10;
}

/** `Server-Timing` ヘッダーの値：`auth;dur=1.2, watched;dur=30` */
export function formatServerTiming(stages: TimingStage[]): string {
  return stages.map(({ name, ms }) => `${timingName(name)};dur=${roundTimingMs(ms)}`).join(", ");
}

/** 段ごとの時間を測る入れ物 */
export type StageTimer = {
  /** `run` が終わるまでの時間を、その名前の段として記録する（投げたときも記録して、そのまま投げる） */
  time: <T>(name: string, run: () => Promise<T>) => Promise<T>;
  /** 測り始めてから今までの時間を、その名前の段として記録する */
  mark: (name: string) => void;
  /** 自分で測った時間を、その名前の段として記録する（同時に始めた物の、途中と終わりを分けて残すとき） */
  add: (name: string, ms: number) => void;
  /** 記録した段（記録した順） */
  stages: () => TimingStage[];
};

/** 段ごとの時間を測り始める。`now` は ms を返す時計（テストで差し替える） */
export function startStageTimer(now: () => number = () => performance.now()): StageTimer {
  const startedAt = now();
  const recorded: TimingStage[] = [];
  return {
    async time(name, run) {
      const from = now();
      try {
        return await run();
      } finally {
        recorded.push({ name: timingName(name), ms: roundTimingMs(now() - from) });
      }
    },
    mark(name) {
      recorded.push({ name: timingName(name), ms: roundTimingMs(now() - startedAt) });
    },
    add(name, ms) {
      recorded.push({ name: timingName(name), ms: roundTimingMs(ms) });
    },
    stages: () => [...recorded],
  };
}

/** このサーバー（関数のインスタンス）がコードを読み込んだ時刻。立ち上がってからの時間（冷えた起動かどうか）に使う */
const LOADED_AT = Date.now();

/** このサーバーが立ち上がってからの時間（ms）。小さければ、冷えた起動の直後 */
export function instanceAgeMs(nowMs: number = Date.now()): number {
  return Math.max(0, nowMs - LOADED_AT);
}
