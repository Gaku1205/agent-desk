import { generateKeyPairSync } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WatchedRepo } from "../config";
import { appTokenCacheForTest, getReadRateLimit, lowestRateLimit } from "./appToken";
import { etagCacheForTest } from "./client";
import { fetchAllRepos, mainDeployedCacheForTest } from "./fetch";
import { rateLimitForTest } from "./rateLimit";
import type { RepoData } from "./types";

const USER_TOKEN = "ghp_user_token_value";
const APP_TOKEN = "ghs_installation_token_value";
const NOW = new Date("2026-10-30T00:00:00Z");
const REPOS = [{ owner: "o", repo: "r" }];

// 秘密鍵はテストの中でその場で作る
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const ENV = {
  PIPELINE_APP_ID: "12345",
  PIPELINE_APP_PRIVATE_KEY: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
};

type Call = { method: string; path: string; auth: string };

/** GitHub の代わり。どの鍵で何を呼んだかを覚える。データの取得は空の配列を返す */
function fakeGitHub(
  options: {
    installation?: "ok" | "none" | "error";
    tokenEndpoint?: "ok" | "error";
    userRepo?: number;
    dataStatus?: number;
    headers?: Record<string, string>;
  } = {},
) {
  const calls: Call[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const path = `${url.pathname}${url.search}`;
    const auth = new Headers(init?.headers).get("authorization") ?? "";
    calls.push({ method: init?.method ?? "GET", path, auth });
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: options.headers });
    if (url.pathname === "/repos/o/r/installation") {
      if (options.installation === "none") return json({}, 404);
      if (options.installation === "error") throw new Error(`boom ${auth}`);
      return json({ id: 9 });
    }
    if (url.pathname === "/app/installations/9/access_tokens") {
      if (options.tokenEndpoint === "error") return json({}, 500);
      return json({ token: APP_TOKEN, expires_at: "2026-10-30T01:00:00Z" }, 201);
    }
    if (url.pathname === "/repos/o/r") {
      return json({ is_template: false }, options.userRepo ?? 200);
    }
    return json([], options.dataStatus ?? 200);
  };
  return { fetcher, calls };
}

const dataCalls = (calls: Call[]) =>
  calls.filter((c) => !/\/installation$|access_tokens$/.test(c.path) && c.path !== "/repos/o/r");

describe("同期の読み取りの鍵の選び方", () => {
  beforeEach(() => {
    appTokenCacheForTest.clear();
    etagCacheForTest.clear();
    mainDeployedCacheForTest.clear();
    rateLimitForTest.clear();
  });

  it("環境変数があり、App が入っていて、読めると確かめられたら App の鍵で読む", async () => {
    const { fetcher, calls } = fakeGitHub();
    const [result] = await fetchAllRepos(USER_TOKEN, REPOS, { fetcher, now: NOW, env: ENV });
    expect(result.ok).toBe(true);
    const reads = dataCalls(calls);
    expect(reads.length).toBeGreaterThan(0);
    expect(reads.every((c) => c.auth === `Bearer ${APP_TOKEN}`)).toBe(true);
    // 読めるか確かめるのはログインした人のトークン。App の鍵の取得は JWT
    expect(calls.find((c) => c.path === "/repos/o/r" && c.auth === `Bearer ${USER_TOKEN}`)).toBeDefined();
    const jwtCalls = calls.filter((c) => /\/installation$|access_tokens$/.test(c.path));
    expect(jwtCalls).toHaveLength(2);
    expect(jwtCalls.every((c) => c.auth.split(".").length === 3)).toBe(true);
    // 取得のあとの /repos/o/r（is_template）は App の鍵
    expect(calls.some((c) => c.path === "/repos/o/r" && c.auth === `Bearer ${APP_TOKEN}`)).toBe(true);
  });

  it("鍵は使い回し、確かめた結果・インストールも覚える（2回目は鍵の取得も確認もしない）", async () => {
    const { fetcher, calls } = fakeGitHub();
    await fetchAllRepos(USER_TOKEN, REPOS, { fetcher, now: NOW, env: ENV });
    const before = calls.length;
    await fetchAllRepos(USER_TOKEN, REPOS, { fetcher, now: NOW, env: ENV });
    const second = calls.slice(before);
    expect(second.some((c) => /\/installation$|access_tokens$/.test(c.path))).toBe(false);
    expect(second.some((c) => c.auth === `Bearer ${USER_TOKEN}`)).toBe(false);
  });

  it("環境変数が無いときは、ログインした人のトークンで読む（App は呼ばない）", async () => {
    const { fetcher, calls } = fakeGitHub();
    const [result] = await fetchAllRepos(USER_TOKEN, REPOS, { fetcher, now: NOW, env: {} });
    expect(result.ok).toBe(true);
    expect(calls.every((c) => c.auth === `Bearer ${USER_TOKEN}`)).toBe(true);
  });

  it("App の鍵で読む物だけ readAppData（キャッシュ）を通し、読んだ鍵を readSource に入れる", async () => {
    const { fetcher } = fakeGitHub();
    const readAppData = vi.fn((_repo: WatchedRepo, load: () => Promise<RepoData>) => load());
    const [viaApp] = await fetchAllRepos(USER_TOKEN, REPOS, { fetcher, now: NOW, env: ENV, readAppData });
    expect(viaApp.readSource).toBe("app");
    expect(readAppData).toHaveBeenCalledTimes(1);
    expect(readAppData.mock.calls[0][0]).toEqual(REPOS[0]);

    readAppData.mockClear();
    const [viaUser] = await fetchAllRepos(USER_TOKEN, REPOS, { fetcher, now: NOW, env: {}, readAppData });
    expect(viaUser.readSource).toBe("user");
    expect(readAppData).not.toHaveBeenCalled();
  });

  it("覚えた物（readAppData）が返す物をそのまま使い、GitHub には問い合わせない", async () => {
    const { fetcher, calls } = fakeGitHub();
    const [first] = await fetchAllRepos(USER_TOKEN, REPOS, { fetcher, now: NOW, env: ENV });
    if (!first.ok) throw new Error("取れていない");
    const before = calls.length;
    const [second] = await fetchAllRepos(USER_TOKEN, REPOS, {
      fetcher,
      now: NOW,
      env: ENV,
      readAppData: async () => first.data,
    });
    expect(second.ok && second.data).toEqual(first.data);
    expect(dataCalls(calls.slice(before))).toHaveLength(0);
  });

  it("環境変数の鍵が読めないときも、ログインした人のトークンで読む", async () => {
    const { fetcher, calls } = fakeGitHub();
    await fetchAllRepos(USER_TOKEN, REPOS, {
      fetcher,
      now: NOW,
      env: { PIPELINE_APP_ID: "1", PIPELINE_APP_PRIVATE_KEY: "broken" },
    });
    expect(calls.every((c) => c.auth === `Bearer ${USER_TOKEN}`)).toBe(true);
  });

  it("App が入っていないリポジトリは、ログインした人のトークンで読む", async () => {
    const { fetcher, calls } = fakeGitHub({ installation: "none" });
    const [result] = await fetchAllRepos(USER_TOKEN, REPOS, { fetcher, now: NOW, env: ENV });
    expect(result.ok).toBe(true);
    expect(dataCalls(calls).every((c) => c.auth === `Bearer ${USER_TOKEN}`)).toBe(true);
  });

  it("インストールを調べる通信が失敗しても、落ちずにログインした人のトークンで読む", async () => {
    const { fetcher, calls } = fakeGitHub({ installation: "error" });
    const [result] = await fetchAllRepos(USER_TOKEN, REPOS, { fetcher, now: NOW, env: ENV });
    expect(result.ok).toBe(true);
    expect(dataCalls(calls).every((c) => c.auth === `Bearer ${USER_TOKEN}`)).toBe(true);
  });

  it("鍵が取れないときは、ログインした人のトークンで読む", async () => {
    const { fetcher, calls } = fakeGitHub({ tokenEndpoint: "error" });
    const [result] = await fetchAllRepos(USER_TOKEN, REPOS, { fetcher, now: NOW, env: ENV });
    expect(result.ok).toBe(true);
    expect(dataCalls(calls).every((c) => c.auth === `Bearer ${USER_TOKEN}`)).toBe(true);
  });

  it("ログインした人のトークンで読めると確かめられないリポジトリは、App の鍵で読まない", async () => {
    const { fetcher, calls } = fakeGitHub({ userRepo: 404 });
    await fetchAllRepos(USER_TOKEN, REPOS, { fetcher, now: NOW, env: ENV });
    expect(calls.some((c) => c.auth === `Bearer ${APP_TOKEN}`)).toBe(false);
  });

  it("確かめられなかった結果（404）も10分は覚える", async () => {
    const { fetcher, calls } = fakeGitHub({ userRepo: 404 });
    await fetchAllRepos(USER_TOKEN, REPOS, { fetcher, now: NOW, env: ENV });
    const checks = () =>
      calls.filter((c) => c.path === "/repos/o/r" && c.auth === `Bearer ${USER_TOKEN}`).length;
    const first = checks();
    await fetchAllRepos(USER_TOKEN, REPOS, { fetcher, now: new Date(NOW.getTime() + 60_000), env: ENV });
    expect(appTokenCacheForTest.sizes().readChecks).toBe(1);
    // 2回目は確認のための呼び出しが増えない（is_template の取得は1回増える）
    expect(checks()).toBe(first + 1);
  });

  it("回数制限の知らせは、App の鍵のときだけ「（パイプラインのApp）」が付く", async () => {
    const reset = String(Math.floor(NOW.getTime() / 1000) + 3600);
    const app = fakeGitHub({
      dataStatus: 403,
      headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": reset },
    });
    const [viaApp] = await fetchAllRepos(USER_TOKEN, REPOS, {
      fetcher: app.fetcher,
      now: NOW,
      env: ENV,
    });
    expect(viaApp.ok).toBe(false);
    if (!viaApp.ok) {
      expect(viaApp.error.kind).toBe("rate_limited");
      expect(viaApp.error.message).toMatch(/^GitHubのレート制限（パイプラインのApp）に達しました。\d\d:\d\d（日本時間）ごろに回復します$/);
    }

    appTokenCacheForTest.clear();
    const user = fakeGitHub({ dataStatus: 403, headers: { "x-ratelimit-remaining": "0" } });
    const [viaUser] = await fetchAllRepos(USER_TOKEN, REPOS, {
      fetcher: user.fetcher,
      now: NOW,
      env: {},
    });
    expect(viaUser.ok).toBe(false);
    if (!viaUser.ok) {
      expect(viaUser.error.message).toBe(
        "GitHubのレート制限に達しました。しばらくしてからもう一度試してください",
      );
    }
  });

  it("時刻が分からないときの App の文言", async () => {
    const { fetcher } = fakeGitHub({ dataStatus: 429 });
    const [result] = await fetchAllRepos(USER_TOKEN, REPOS, { fetcher, now: NOW, env: ENV });
    expect(!result.ok && result.error.message).toBe(
      "GitHubのレート制限（パイプラインのApp）に達しました。しばらくしてからもう一度試してください",
    );
  });

  it("秘密鍵・鍵はエラー文に出ない", async () => {
    const { fetcher } = fakeGitHub({ dataStatus: 500 });
    const [result] = await fetchAllRepos(USER_TOKEN, REPOS, { fetcher, now: NOW, env: ENV });
    const text = JSON.stringify(result);
    expect(text).not.toContain(APP_TOKEN);
    expect(text).not.toContain("PRIVATE KEY");
    expect(text).not.toContain(USER_TOKEN);
  });
});

describe("回数制限の残り", () => {
  beforeEach(() => {
    appTokenCacheForTest.clear();
    rateLimitForTest.clear();
  });

  it("lowestRateLimit は不明でない中でいちばん少ない物", () => {
    expect(lowestRateLimit([])).toEqual({ remaining: null, resetAt: null });
    expect(
      lowestRateLimit(
        [
          { remaining: null, resetAt: null },
          { remaining: 900, resetAt: 5 },
          { remaining: 100, resetAt: 7 },
        ],
        0,
      ),
    ).toEqual({ remaining: 100, resetAt: 7 });
  });

  it("lowestRateLimit は回復する時刻を過ぎた古い記録を飛ばす", () => {
    expect(
      lowestRateLimit(
        [
          { remaining: 0, resetAt: 10 },
          { remaining: 200, resetAt: 100 },
        ],
        10_000,
      ),
    ).toEqual({ remaining: 200, resetAt: 100 });
    expect(lowestRateLimit([{ remaining: 0, resetAt: 10 }], 10_000)).toEqual({
      remaining: null,
      resetAt: null,
    });
  });

  it("App の鍵で読んだあとは、App の残りが少なければそちらで決める", async () => {
    etagCacheForTest.clear();
    mainDeployedCacheForTest.clear();
    const { fetcher } = fakeGitHub({
      headers: { "x-ratelimit-remaining": "321", "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 3600) },
    });
    await fetchAllRepos(USER_TOKEN, REPOS, { fetcher, now: NOW, env: ENV });
    expect(getReadRateLimit(USER_TOKEN).remaining).toBe(321);
  });
});
