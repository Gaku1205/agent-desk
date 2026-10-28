import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  decideLoginScope,
  getLoginScope,
  loginScopeCacheForTest,
  PRIVATE_SCOPE,
  PUBLIC_SCOPE,
  VISIBILITY_TTL_MS,
} from "./loginScope";

const a = { owner: "o", repo: "a" };
const b = { owner: "o", repo: "b" };

function fakeFetch(map: Record<string, unknown>) {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    void init;
    const name = String(url).replace("https://api.github.com/repos/", "");
    const body = map[name];
    if (body === undefined) return new Response("{}", { status: 404 });
    if (body === "error") throw new Error("network");
    return new Response(JSON.stringify(body), { status: 200 });
  });
}

beforeEach(() => loginScopeCacheForTest.clear());

describe("decideLoginScope", () => {
  it("全部公開なら public_repo", async () => {
    const fetcher = fakeFetch({ "o/a": { private: false }, "o/b": { private: false } });
    expect(await decideLoginScope([a, b], { fetcher })).toBe(PUBLIC_SCOPE);
  });

  it("トークンを付けずに調べる", async () => {
    const fetcher = fakeFetch({ "o/a": { private: false } });
    await decideLoginScope([a], { fetcher });
    const headers = fetcher.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });

  it("1つ非公開なら repo", async () => {
    const fetcher = fakeFetch({ "o/a": { private: false }, "o/b": { private: true } });
    expect(await decideLoginScope([a, b], { fetcher })).toBe(PRIVATE_SCOPE);
  });

  it.each([
    ["404", {}],
    ["通信失敗", { "o/a": "error" }],
    ["private が読めない", { "o/a": { name: "a" } }],
  ])("取得失敗（%s）なら repo", async (_name, map) => {
    expect(await decideLoginScope([a], { fetcher: fakeFetch(map) })).toBe(PRIVATE_SCOPE);
  });

  it("0件なら repo", async () => {
    expect(await decideLoginScope([], { fetcher: fakeFetch({}) })).toBe(PRIVATE_SCOPE);
  });

  it("結果を覚えて再利用し、期限が切れたら調べ直す", async () => {
    const fetcher = fakeFetch({ "o/a": { private: false } });
    let t = 1000;
    const now = () => t;
    await decideLoginScope([a], { fetcher, now });
    t += VISIBILITY_TTL_MS - 1;
    await decideLoginScope([a], { fetcher, now });
    expect(fetcher).toHaveBeenCalledTimes(1);
    t += 2;
    await decideLoginScope([a], { fetcher, now });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("失敗は覚えない", async () => {
    await decideLoginScope([a], { fetcher: fakeFetch({}) });
    const ok = fakeFetch({ "o/a": { private: false } });
    expect(await decideLoginScope([a], { fetcher: ok })).toBe(PUBLIC_SCOPE);
  });
});

describe("getLoginScope", () => {
  it("SETTINGS_REPO が非公開なら repo", async () => {
    const fetcher = fakeFetch({ "o/a": { private: false }, "o/s": { private: true } });
    const env = { WATCHED_REPOS: "o/a", SETTINGS_REPO: "o/s" };
    expect(await getLoginScope(env, { fetcher })).toBe(PRIVATE_SCOPE);
  });

  it("SETTINGS_REPO が無ければ監視分だけで決める", async () => {
    const fetcher = fakeFetch({ "o/a": { private: false } });
    expect(await getLoginScope({ WATCHED_REPOS: "o/a" }, { fetcher })).toBe(PUBLIC_SCOPE);
  });

  it("WATCHED_REPOS が空なら repo", async () => {
    expect(await getLoginScope({}, { fetcher: fakeFetch({}) })).toBe(PRIVATE_SCOPE);
  });
});
