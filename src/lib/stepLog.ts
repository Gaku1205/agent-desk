/** 進捗ログ（Issue のコメント）の読み取り。形式は docs/pipeline.md の「進捗ログ」 */

/** 進捗ログの `step` と、進捗図の工程の対応（`mocks` はデザイン） */
const STEP_KEYS = {
  plan: "plan",
  mocks: "design",
  implement: "implement",
  ci: "ci",
  review: "review",
  fix: "fix",
  deploy: "deploy",
} as const;

export type StepLogKey = (typeof STEP_KEYS)[keyof typeof STEP_KEYS];

/** 進捗ログのコメントの目印（先頭の行） */
export const STEP_LOG_MARKER = "<!-- ai-step-log -->";

/** 1工程ぶんの読み取り結果。`model` は使わない工程・記録が無いとき null、`duration` は出せないとき null */
export type StepInfo = {
  key: StepLogKey;
  model: string | null;
  duration: string | null;
};

/** そのコメントが進捗ログか（先頭の行が目印） */
export function isStepLogComment(body: string): boolean {
  return body.trimStart().startsWith(STEP_LOG_MARKER);
}

/** `3分12秒`・`45秒`・`1時間5分` のように短く整形する。負・数でないときは null */
export function formatDuration(ms: number): string | null {
  if (!Number.isFinite(ms) || ms < 0) return null;
  const total = Math.floor(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return minutes > 0 ? `${hours}時間${minutes}分` : `${hours}時間`;
  if (minutes > 0) return seconds > 0 ? `${minutes}分${seconds}秒` : `${minutes}分`;
  return `${seconds}秒`;
}

function parseTime(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : time;
}

function parseLine(json: string, now: Date): StepInfo | null {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
  const row = data as Record<string, unknown>;
  const step = row.step;
  if (typeof step !== "string" || !Object.hasOwn(STEP_KEYS, step)) return null;
  const model = row.model;
  if (model !== null && typeof model !== "string") return null;
  const result = row.result;
  if (result !== "running" && result !== "success" && result !== "failure") return null;
  const started = parseTime(row.started);
  if (started === null) return null;
  // `finished` は必須の項目（未完了なら null）
  if (!("finished" in row)) return null;
  let end: number;
  if (row.finished === null) end = now.getTime();
  else {
    const finished = parseTime(row.finished);
    if (finished === null) return null;
    end = finished;
  }
  return {
    key: STEP_KEYS[step as keyof typeof STEP_KEYS],
    model: model === null || model.trim() === "" ? null : model.trim(),
    duration: formatDuration(end - started),
  };
}

/**
 * 進捗ログのコメントの本文から、工程ごとの記録を読む。
 * 壊れた JSON・知らない `step`・欠けた項目の行は読み飛ばす。同じ工程が複数あれば最後の行を使う。
 * `finished` が null（進行中）の所要時間は、`now` までの経過時間
 */
export function parseStepLog(body: string, now: Date): StepInfo[] {
  const byKey = new Map<StepLogKey, StepInfo>();
  for (const line of body.split(/\r?\n/)) {
    const match = /^\s*<!--\s*ai-step\s+(\{.*\})\s*-->\s*$/.exec(line);
    if (!match) continue;
    const info = parseLine(match[1], now);
    if (info) byKey.set(info.key, info);
  }
  return [...byKey.values()];
}
