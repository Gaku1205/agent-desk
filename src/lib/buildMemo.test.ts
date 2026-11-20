import { describe, expect, it } from "vitest";
import { buildLayoutNumbers, createBuildMemo } from "./buildMemo";
import type { RepoData, RepoResult } from "./github/types";
import { buildLanesSource } from "./lanes/source";
import { countRunningPipelineRows } from "./runningPipeline";
import { buildTurnItems } from "./turn";

const data = (): RepoData => ({ issues: [], pulls: [], comments: [], pullChecks: {}, events: [] });
const ok = (owner: string, repo: string): RepoResult => ({ owner, repo, ok: true, data: data() });
const failed = (owner: string, repo: string): RepoResult =>
  ({ owner, repo, ok: false, error: "boom" }) as unknown as RepoResult;

const NOW = new Date("2026-11-21T00:00:00Z");

describe("createBuildMemo", () => {
  it("レイアウトとページが同じ結果から組み立てても、全部のリポジトリの組み立ては1回になる", () => {
    const memo = createBuildMemo();
    const results = [ok("o", "a"), ok("o", "b"), failed("o", "c")];
    // レイアウト
    buildLayoutNumbers(memo, results, NOW);
    // ページ（同じ結果の別の配列・同じ時刻）
    const pageResults = [...results];
    memo.turnItems(pageResults, NOW);
    memo.runningCounts(pageResults, NOW);
    memo.lanesSource(pageResults, NOW);
    expect(memo.calls()).toEqual({ turn: 3, running: 3, lanes: 1 });
  });

  it("リポジトリごとの数（左のバー）も、全部の組み立てがリポジトリごとに覚えた物を使い回す", () => {
    const memo = createBuildMemo();
    const results = [ok("o", "a"), ok("o", "b")];
    // 読み終えたリポジトリから順に（1つずつ）
    memo.turnItems([results[0]], NOW);
    memo.runningCounts([results[0]], NOW);
    memo.turnItems([results[1]], NOW);
    memo.runningCounts([results[1]], NOW);
    // そのあとの全部の組み立て
    buildLayoutNumbers(memo, results, NOW);
    expect(memo.calls()).toEqual({ turn: 2, running: 2, lanes: 1 });
  });

  it("結果や時刻が違えば組み立て直す", () => {
    const memo = createBuildMemo();
    const results = [ok("o", "a")];
    memo.lanesSource(results, NOW);
    memo.lanesSource([ok("o", "a")], NOW);
    memo.lanesSource(results, new Date(NOW.getTime() + 1));
    expect(memo.calls().lanes).toBe(3);
  });

  it("組み立てた中身は、覚えを使わない作り方と同じ", () => {
    const memo = createBuildMemo();
    const results = [ok("o", "a"), ok("o", "b"), failed("o", "c")];
    expect(memo.turnItems(results, NOW)).toEqual(buildTurnItems(results, NOW));
    expect(memo.runningCounts(results, NOW)).toEqual(countRunningPipelineRows(results, NOW));
    expect(memo.lanesSource(results, NOW)).toEqual(buildLanesSource(results, NOW));
  });
});
