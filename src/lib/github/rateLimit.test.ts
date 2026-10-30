import { beforeEach, describe, expect, it } from "vitest";
import { GitHubClient } from "./client";
import { GitHubError } from "./errors";
import { getReadRateLimit } from "./appToken";
import {
  getGraphqlRateLimit,
  getRateLimit,
  getRateLimits,
  parseGraphqlRateLimit,
  parseRateLimit,
  rateLimitForTest,
} from "./rateLimit";

const TOKEN = "ghp_secret_token_value";

function res(status: number, headers: Record<string, string>, body: unknown = {}): Response {
  return new Response(status === 304 ? null : JSON.stringify(body), { status, headers });
}

describe("parseRateLimit", () => {
  it("残りと回復する時刻を数にする。無い・壊れていれば null", () => {
    expect(
      parseRateLimit(new Headers({ "x-ratelimit-remaining": "1234", "x-ratelimit-reset": "99" })),
    ).toEqual({ remaining: 1234, resetAt: 99 });
    expect(parseRateLimit(new Headers())).toEqual({ remaining: null, resetAt: null });
    expect(parseRateLimit(new Headers({ "x-ratelimit-remaining": "abc" })).remaining).toBeNull();
  });
});

describe("GitHubClient の回数制限の記憶", () => {
  beforeEach(() => rateLimitForTest.clear());

  it("返事のヘッダーを覚える。キーはトークンのハッシュ", async () => {
    const client = new GitHubClient(TOKEN, async () =>
      res(200, { "x-ratelimit-remaining": "4000", "x-ratelimit-reset": "1000" }),
    );
    expect(getRateLimit(TOKEN)).toEqual({ remaining: null, resetAt: null });
    await client.get("/x");
    expect(getRateLimit(TOKEN)).toEqual({ remaining: 4000, resetAt: 1000 });
    expect(rateLimitForTest.keys().join("")).not.toContain(TOKEN);
  });

  it("304の返事のヘッダーも覚える", async () => {
    let n = 0;
    const client = new GitHubClient(TOKEN, async () =>
      n++ === 0
        ? res(200, { etag: '"a"', "x-ratelimit-remaining": "900", "x-ratelimit-reset": "1000" })
        : res(304, { "x-ratelimit-remaining": "899", "x-ratelimit-reset": "1000" }),
    );
    await client.get("/x");
    await client.get("/x");
    expect(getRateLimit(TOKEN).remaining).toBe(899);
  });

  it("書き込み（send）の返事も覚える", async () => {
    const client = new GitHubClient(TOKEN, async () =>
      res(200, { "x-ratelimit-remaining": "321", "x-ratelimit-reset": "2000" }),
    );
    await client.send("POST", "/x", {});
    expect(getRateLimit(TOKEN)).toEqual({ remaining: 321, resetAt: 2000 });
  });

  it("別のトークンの分とは混ざらない", async () => {
    const client = new GitHubClient(TOKEN, async () =>
      res(200, { "x-ratelimit-remaining": "10", "x-ratelimit-reset": "1" }),
    );
    await client.get("/x");
    expect(getRateLimit("other-token")).toEqual({ remaining: null, resetAt: null });
  });

  it("レート制限のエラーが回復する時刻を持つ", async () => {
    const reset = Date.parse("2026-10-28T06:42:00Z") / 1000;
    const client = new GitHubClient(TOKEN, async () =>
      res(403, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(reset) }),
    );
    const e = (await client.get("/x").catch((err: unknown) => err)) as GitHubError;
    expect(e.kind).toBe("rate_limited");
    expect(e.rateLimitResetAt).toBe(reset);
    expect(e.message).toBe("GitHubのレート制限に達しました。15:42（日本時間）ごろに回復します");
    expect(getRateLimit(TOKEN).remaining).toBe(0);
  });
});

describe("GraphQL の回数制限", () => {
  beforeEach(() => rateLimitForTest.clear());

  it("parseGraphqlRateLimit は remaining と ISO の resetAt（UNIX秒にする）を読む", () => {
    expect(parseGraphqlRateLimit({ cost: 1, remaining: 4321, resetAt: "2026-10-30T01:00:00Z" })).toEqual({
      remaining: 4321,
      resetAt: Date.parse("2026-10-30T01:00:00Z") / 1000,
    });
    expect(parseGraphqlRateLimit(null)).toEqual({ remaining: null, resetAt: null });
    expect(parseGraphqlRateLimit({ remaining: "x", resetAt: "y" })).toEqual({ remaining: null, resetAt: null });
  });

  it("問い合わせの rateLimit を、REST とは別の枠として覚える", async () => {
    const client = new GitHubClient(TOKEN, async () =>
      res(
        200,
        { "x-ratelimit-remaining": "4999", "x-ratelimit-reset": "1000" },
        { data: { rateLimit: { cost: 3, remaining: 1200, resetAt: "2026-10-30T01:00:00Z" } } },
      ),
    );
    await client.graphql("q", {});
    expect(getRateLimit(TOKEN)).toEqual({ remaining: null, resetAt: null });
    expect(getGraphqlRateLimit(TOKEN).remaining).toBe(1200);
    expect(rateLimitForTest.keys().join("")).not.toContain(TOKEN);
  });

  it("rateLimit が無ければ返事のヘッダーを使う", async () => {
    const client = new GitHubClient(TOKEN, async () =>
      res(200, { "x-ratelimit-remaining": "777", "x-ratelimit-reset": "1000" }, { data: {} }),
    );
    await client.graphql("q", {});
    expect(getGraphqlRateLimit(TOKEN)).toEqual({ remaining: 777, resetAt: 1000 });
  });

  it("getRateLimits は REST と GraphQL の両方を返し、読み取りの残りは少ない方になる", async () => {
    const future = Math.floor(Date.now() / 1000) + 3600;
    const resetAt = new Date(future * 1000).toISOString();
    const client = new GitHubClient(TOKEN, async (url) =>
      String(url).endsWith("/graphql")
        ? res(200, {}, { data: { rateLimit: { remaining: 300, resetAt } } })
        : res(200, { "x-ratelimit-remaining": "4000", "x-ratelimit-reset": String(future) }),
    );
    await client.get("/x");
    await client.graphql("q", {});
    expect(getRateLimits(TOKEN).map((info) => info.remaining)).toEqual([4000, 300]);
    expect(getReadRateLimit(TOKEN).remaining).toBe(300);
  });

  it("RATE_LIMITED のエラーは、問い合わせの resetAt を回復する時刻に使う", async () => {
    const client = new GitHubClient(TOKEN, async () =>
      res(200, {}, {
        data: { rateLimit: { remaining: 0, resetAt: "2026-10-28T06:42:00Z" } },
        errors: [{ type: "RATE_LIMITED" }],
      }),
    );
    const e = (await client.graphql("q", {}).catch((err: unknown) => err)) as GitHubError;
    expect(e.kind).toBe("rate_limited");
    expect(e.message).toBe("GitHubのレート制限に達しました。15:42（日本時間）ごろに回復します");
    expect(getGraphqlRateLimit(TOKEN).remaining).toBe(0);
  });
});

describe("GitHubError のレート制限の文言", () => {
  it("Resetが無ければ今の文言のまま", () => {
    expect(new GitHubError("rate_limited", 429).message).toBe(
      "GitHubのレート制限に達しました。しばらくしてからもう一度試してください",
    );
  });

  it("Resetがあっても、レート制限以外の種類には使わない", () => {
    expect(new GitHubError("forbidden", 403, 1000).message).toBe(
      "このリポジトリを読む権限がありません",
    );
  });
});
