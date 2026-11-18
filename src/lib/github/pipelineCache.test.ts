import { beforeEach, describe, expect, it } from "vitest";
import { etagCacheForTest, GitHubClient, type Fetcher } from "./client";
import {
  cachedHasPipeline,
  clearPipelineMemoForTest,
  PIPELINE_MEMO_TTL_MS,
  pipelineMemoKey,
  readPipelineMemo,
  writePipelineMemo,
  type PipelineMemo,
} from "./pipelineCache";

const target = { owner: "Gaku1205", repo: "agent-desk" };

function countingFetcher(status: number, headers?: Record<string, string>): { fetcher: Fetcher; count: () => number } {
  let calls = 0;
  const fetcher: Fetcher = async () => {
    calls += 1;
    return new Response(JSON.stringify({}), { status, headers });
  };
  return { fetcher, count: () => calls };
}

beforeEach(() => {
  etagCacheForTest.clear();
  clearPipelineMemoForTest();
});

describe("pipelineMemoKey", () => {
  it("トークンそのものを含まず、トークンとリポジトリで変わる", () => {
    const key = pipelineMemoKey("secret-token", target);
    expect(key).not.toContain("secret-token");
    expect(key).not.toBe(pipelineMemoKey("other-token", target));
    expect(key).not.toBe(pipelineMemoKey("secret-token", { owner: "Gaku1205", repo: "other" }));
    expect(key).toBe(pipelineMemoKey("secret-token", { owner: "gaku1205", repo: "AGENT-DESK" }));
  });
});

describe("readPipelineMemo / writePipelineMemo", () => {
  it("10分の内は使え、10分たつと使えない", () => {
    const memo: PipelineMemo = new Map();
    writePipelineMemo(memo, "k", false, 1000);
    expect(readPipelineMemo(memo, "k", 1000 + PIPELINE_MEMO_TTL_MS - 1)).toBe(false);
    expect(readPipelineMemo(memo, "k", 1000 + PIPELINE_MEMO_TTL_MS)).toBeUndefined();
    expect(memo.size).toBe(0);
  });

  it("確かめられなかった結果（null）は覚えない", () => {
    const memo: PipelineMemo = new Map();
    writePipelineMemo(memo, "k", null, 1000);
    expect(memo.size).toBe(0);
  });

  it("件数の上限を越えるときは、寿命の切れた物→いちばん古い物の順に捨てる", () => {
    const memo: PipelineMemo = new Map();
    writePipelineMemo(memo, "a", true, 0, 3);
    writePipelineMemo(memo, "b", true, 1, 3);
    writePipelineMemo(memo, "c", true, 2, 3);
    writePipelineMemo(memo, "d", true, 3, 3);
    expect([...memo.keys()]).toEqual(["b", "c", "d"]);
    writePipelineMemo(memo, "e", true, PIPELINE_MEMO_TTL_MS + 2, 3);
    expect([...memo.keys()]).toEqual(["d", "e"]);
  });
});

describe("cachedHasPipeline", () => {
  it("あり・なしは覚え、10分以内に開き直すと GitHub を呼ばない", async () => {
    const yes = countingFetcher(200);
    const client = new GitHubClient("t", yes.fetcher);
    let now = 0;
    expect(await cachedHasPipeline(client, "t", target, () => now)).toBe(true);
    now = PIPELINE_MEMO_TTL_MS - 1;
    expect(await cachedHasPipeline(client, "t", target, () => now)).toBe(true);
    expect(yes.count()).toBe(1);
    now = PIPELINE_MEMO_TTL_MS + 1;
    await cachedHasPipeline(client, "t", target, () => now);
    expect(yes.count()).toBe(2);
  });

  it("見つからない（404）も「なし」として覚える", async () => {
    const no = countingFetcher(404);
    const client = new GitHubClient("t", no.fetcher);
    expect(await cachedHasPipeline(client, "t", target)).toBe(false);
    expect(await cachedHasPipeline(client, "t", target)).toBe(false);
    expect(no.count()).toBe(1);
  });

  it("通信失敗・レート制限は覚えない（次はまた GitHub を呼ぶ）", async () => {
    const failing = countingFetcher(500);
    const client = new GitHubClient("t", failing.fetcher);
    expect(await cachedHasPipeline(client, "t", target)).toBe(false);
    expect(await cachedHasPipeline(client, "t", target)).toBe(false);
    expect(failing.count()).toBe(2);

    const limited = countingFetcher(403, { "x-ratelimit-remaining": "0" });
    const limitedClient = new GitHubClient("t2", limited.fetcher);
    await cachedHasPipeline(limitedClient, "t2", target);
    await cachedHasPipeline(limitedClient, "t2", target);
    expect(limited.count()).toBe(2);

    const broken: Fetcher = async () => {
      throw new Error("network");
    };
    let calls = 0;
    const throwing: Fetcher = async (...args) => {
      calls += 1;
      return broken(...args);
    };
    const networkClient = new GitHubClient("t3", throwing);
    await cachedHasPipeline(networkClient, "t3", target);
    await cachedHasPipeline(networkClient, "t3", target);
    expect(calls).toBeGreaterThanOrEqual(2);
  });
});
