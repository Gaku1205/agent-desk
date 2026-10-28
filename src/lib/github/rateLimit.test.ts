import { beforeEach, describe, expect, it } from "vitest";
import { GitHubClient } from "./client";
import { GitHubError } from "./errors";
import { getRateLimit, parseRateLimit, rateLimitForTest } from "./rateLimit";

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
