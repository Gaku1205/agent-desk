/** 1つの期間ぶんの Dashboard の数字（サーバーで作った小さな値。画面に渡す） */

import type { RepoResult } from "../github/types";
import { aiUsage, type AiUsage } from "./aiUsage";
import { LOCAL_PERIOD_KEYS, type LocalPeriodKey, type PeriodKey } from "./period";
import { stops, type Stops } from "./stops";
import { summarize, type Summary } from "./summary";
import { throughput, type Throughput } from "./throughput";

export type PeriodBundle = {
  summary: Summary;
  throughput: Throughput;
  aiUsage: AiUsage;
  stops: Stops;
  /** この数字を数えた「今」（ISO文字列）。見出しの下の範囲に使う */
  now: string;
};

/** 入力の結果から、1つの期間ぶんを数える。読めたリポジトリが無ければ、数字は全部 `—`（null） */
export function buildBundle(results: readonly RepoResult[], now: Date, key: PeriodKey): PeriodBundle {
  return {
    summary: summarize(results, now, key),
    throughput: throughput(results, now, key),
    aiUsage: aiUsage(results, now, key),
    stops: stops(results, now, key),
    now: now.toISOString(),
  };
}

/** `loadTurns` の直近14日だけで数えられる期間（`24h`・`7d`）。追加で GitHub を読まない */
export function buildLocalBundles(results: readonly RepoResult[], now: Date): Record<LocalPeriodKey, PeriodBundle> {
  return Object.fromEntries(LOCAL_PERIOD_KEYS.map((key) => [key, buildBundle(results, now, key)])) as Record<
    LocalPeriodKey,
    PeriodBundle
  >;
}

/** 専用に取った60日分の結果から `30d` を数える（取れなかったリポジトリは `ok: false` のまま渡す） */
export function buildExtendedBundle(results: readonly RepoResult[], now: Date): PeriodBundle {
  return buildBundle(results, now, "30d");
}
