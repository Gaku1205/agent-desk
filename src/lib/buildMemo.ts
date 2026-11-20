import { cache } from "react";
import type { RepoResult } from "./github/types";
import { buildLanesSource, type LanesSource } from "./lanes/source";
import { countRunningPipelineRows } from "./runningPipeline";
import { buildTurnItems, compareTurnItems, countTurnItems,type TurnCounts, type TurnItem } from "./turn";

/** 何回組み立てたか（種類ごと。`turn`・`running` はリポジトリ1つの組み立てを1回と数える） */
export type BuildCalls = { turn: number; running: number; lanes: number };

export type BuildMemo = {
  /** 全部（または一部）のリポジトリの「あなたの番」。リポジトリごとに組み立てて覚え、並べ直すだけ */
  turnItems(results: RepoResult[], now: Date): TurnItem[];
  /** 「AIが動いている」の件数。リポジトリごとに数えて覚え、足し合わせる */
  runningCounts(results: RepoResult[], now: Date): TurnCounts;
  /** Slots & Queue の材料 */
  lanesSource(results: RepoResult[], now: Date): LanesSource;
  /** ここまでに組み立てた回数 */
  calls(): BuildCalls;
};

/**
 * 同じ結果（`RepoResult` の同じ物）と同じ時刻からの組み立てを、1回だけにする覚え（docs/spec.md の「組み立ては1リクエスト1回」）。
 * 鍵は結果の物としての同一性と時刻。リクエストごとに作る（`getBuildMemo`）。
 */
export function createBuildMemo(): BuildMemo {
  const ids = new WeakMap<object, number>();
  let nextId = 0;
  const idOf = (result: RepoResult): number => {
    let id = ids.get(result);
    if (id === undefined) {
      id = nextId++;
      ids.set(result, id);
    }
    return id;
  };
  const keyOf = (results: readonly RepoResult[], now: Date): string => `${now.getTime()}:${results.map(idOf).join(",")}`;
  const turn = new Map<string, TurnItem[]>();
  const running = new Map<string, TurnCounts>();
  const lanes = new Map<string, LanesSource>();
  const calls: BuildCalls = { turn: 0, running: 0, lanes: 0 };

  const turnOf = (result: RepoResult, now: Date): TurnItem[] => {
    const key = keyOf([result], now);
    let items = turn.get(key);
    if (!items) {
      calls.turn += 1;
      items = buildTurnItems([result], now);
      turn.set(key, items);
    }
    return items;
  };
  const runningOf = (result: RepoResult, now: Date): TurnCounts => {
    const key = keyOf([result], now);
    let counts = running.get(key);
    if (!counts) {
      calls.running += 1;
      counts = countRunningPipelineRows([result], now);
      running.set(key, counts);
    }
    return counts;
  };

  return {
    turnItems: (results, now) => results.flatMap((result) => turnOf(result, now)).sort(compareTurnItems),
    runningCounts: (results, now) => {
      const byRepo: Record<string, number> = {};
      for (const result of results) {
        for (const [key, count] of Object.entries(runningOf(result, now).byRepo)) byRepo[key] = (byRepo[key] ?? 0) + count;
      }
      return { byRepo };
    },
    lanesSource: (results, now) => {
      const key = keyOf(results, now);
      let source = lanes.get(key);
      if (!source) {
        calls.lanes += 1;
        source = buildLanesSource(results, now);
        lanes.set(key, source);
      }
      return source;
    },
    calls: () => ({ ...calls }),
  };
}

/** このリクエストの覚え（レイアウトとページで同じ物。`cache()` はリクエストごと） */
export const getBuildMemo = cache(createBuildMemo);

/** このリクエストの「いま」（レイアウトの1リポジトリごとの数と、全部の組み立てで同じ時刻にして、覚えを使い回す） */
export const getRequestNow = cache(() => new Date());

/** レイアウトが全部のリポジトリから作る数（左のバー・上の帯の件数、使用中の枠）。ページと同じ組み立てを使い回す */
export function buildLayoutNumbers(memo: BuildMemo, results: RepoResult[], now: Date) {
  return {
    counts: countTurnItems(memo.turnItems(results, now)),
    runningCounts: memo.runningCounts(results, now),
    works: memo.lanesSource(results, now).works.length,
  };
}
