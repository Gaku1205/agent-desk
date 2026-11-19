import { describe, expect, it } from "vitest";
import { GitHubClient, etagCacheForTest } from "./client";
import { GitHubError } from "./errors";
import { GITHUB_READ_TIMEOUT_MS, isReadTimedOut, readTimeoutSignal } from "./readTimeout";

describe("読み取りの時間切れ", () => {
  it("15秒", () => {
    expect(GITHUB_READ_TIMEOUT_MS).toBe(15_000);
  });

  it("合図が鳴っていれば時間切れ", async () => {
    const signal = readTimeoutSignal(1);
    expect(isReadTimedOut(signal)).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(isReadTimedOut(signal)).toBe(true);
  });
});

/** 合図が鳴るまで返事をしない偽の fetch */
const hangingFetch = ((_url: unknown, init?: RequestInit) =>
  new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
  })) as typeof fetch;

describe("GitHubClient：返事が来ないとき", () => {
  it("REST は GitHubError(other) で終わり、時間切れの印が付く", async () => {
    etagCacheForTest.clear();
    const client = new GitHubClient("t", hangingFetch, { timeoutMs: 20 });
    const error = await client.request("/x").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GitHubError);
    expect((error as GitHubError).kind).toBe("other");
    expect((error as GitHubError).timedOut).toBe(true);
  });

  it("GraphQL も同じ", async () => {
    const client = new GitHubClient("t", hangingFetch, { timeoutMs: 20 });
    const error = await client.graphql("query {}", {}).catch((e: unknown) => e);
    expect((error as GitHubError).kind).toBe("other");
    expect((error as GitHubError).timedOut).toBe(true);
  });

  it("ふつうの通信失敗は時間切れの印が付かない", async () => {
    const client = new GitHubClient("t", (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch);
    const error = await client.graphql("query {}", {}).catch((e: unknown) => e);
    expect((error as GitHubError).timedOut).toBe(false);
  });
});
