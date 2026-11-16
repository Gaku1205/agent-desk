import { beforeEach, describe, expect, it } from "vitest";
import { AUTO_ADD_MIN_INTERVAL_MS } from "../autoAdd";
import {
  autoAddStateForTest,
  AUTO_ADD_VARIABLE,
  AUTO_ADDED_VARIABLE,
  loadAddedLog,
  parseOwnedRepos,
  REMOVED_REPOS_VARIABLE,
  requestAutoAddCheck,
  runAutoAdd,
} from "./autoAdd";
import { etagCacheForTest } from "./client";
import { WATCHED_REPOS_VARIABLE } from "./settings";
import type { RepoResult } from "./types";

const TOKEN = "ghu_user_token_value";
const NOW = new Date("2026-11-16T03:00:00Z");
const SETTINGS = { owner: "gaku", repo: "agent-desk" };
const TEMPLATE = { owner: "gaku", repo: "ai-dev-template" };

type Call = { method: string; path: string; body: string };

/** GitHub の代わり：設定の保存先の Variable と、ユーザーのリポジトリ（GraphQL）を持つ */
function fakeGitHub(variables: Record<string, string>, owned: Array<{ name: string; template: string | null }>) {
  const calls: Call[] = [];
  const store = { ...variables };
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const body = String(init?.body ?? "");
    calls.push({ method, path: url.pathname, body });
    const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
    if (url.pathname === "/graphql") {
      return json({
        data: {
          viewer: {
            repositories: {
              nodes: owned.map((repo) => ({
                nameWithOwner: repo.name,
                templateRepository: repo.template ? { nameWithOwner: repo.template } : null,
              })),
            },
          },
        },
      });
    }
    const variable = /^\/repos\/gaku\/agent-desk\/actions\/variables(?:\/([A-Z_]+))?$/.exec(url.pathname);
    if (variable) {
      const name = variable[1];
      if (method === "GET" && name) return name in store ? json({ name, value: store[name] }) : json({}, 404);
      const parsed = JSON.parse(body) as { name: string; value: string };
      store[parsed.name] = parsed.value;
      return method === "POST" ? json({}, 201) : new Response(null, { status: 204 });
    }
    return json({}, 404);
  };
  return { fetcher, calls, store };
}

function results(templateIssues: Array<{ updatedAt: string; state?: "open" | "closed" }> = []): RepoResult[] {
  return [
    { ...SETTINGS, ok: true, data: { issues: [], pulls: [], comments: [], pullChecks: {}, events: [], isTemplate: false } },
    {
      ...TEMPLATE,
      ok: true,
      data: {
        issues: templateIssues.map((issue, i) => ({
          number: 10 + i,
          title: "新サービス：朝のカード",
          body: "",
          state: issue.state ?? "open",
          labels: [],
          url: "",
          createdAt: issue.updatedAt,
          updatedAt: issue.updatedAt,
          closedAt: null,
        })),
        pulls: [],
        comments: [],
        pullChecks: {},
        events: [],
        isTemplate: true,
      },
    },
  ];
}

const OWNED = [
  { name: "gaku/morning-card", template: "gaku/ai-dev-template" },
  { name: "gaku/plain", template: null },
];
const WATCHED = { [WATCHED_REPOS_VARIABLE]: "gaku/agent-desk,gaku/ai-dev-template" };

describe("runAutoAdd", () => {
  beforeEach(() => {
    autoAddStateForTest.clear();
    etagCacheForTest.clear();
  });

  it("監視リストにテンプレートが無ければ、何も呼ばず、何も変えない", async () => {
    const { fetcher, calls } = fakeGitHub(WATCHED, OWNED);
    requestAutoAddCheck(SETTINGS);
    const added = await runAutoAdd({
      token: TOKEN,
      login: "gaku",
      settingsRepo: SETTINGS,
      results: [results()[0]],
      now: NOW,
      fetcher,
      env: {},
    });
    expect(added).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("テンプレートから作られたリポジトリを監視リストに足し、足した時刻を残す", async () => {
    const { fetcher, store, calls } = fakeGitHub(WATCHED, OWNED);
    const added = await runAutoAdd({ token: TOKEN, login: "gaku", settingsRepo: SETTINGS, results: results(), now: NOW, fetcher, env: {} });
    expect(added).toEqual([{ owner: "gaku", repo: "morning-card" }]);
    expect(store[WATCHED_REPOS_VARIABLE]).toBe("gaku/agent-desk,gaku/ai-dev-template,gaku/morning-card");
    expect(store[AUTO_ADDED_VARIABLE]).toBe("gaku/morning-card@2026-11-16T03:00:00.000Z");
    // GraphQL は1回
    expect(calls.filter((c) => c.path === "/graphql")).toHaveLength(1);
    // トークンは Variable の値に入らない
    expect(JSON.stringify(store)).not.toContain(TOKEN);
  });

  it("同期のたびには調べない：きっかけが無ければ呼ばない", async () => {
    const { fetcher, calls } = fakeGitHub(WATCHED, OWNED);
    const input = { token: TOKEN, login: "gaku", settingsRepo: SETTINGS, results: results(), now: NOW, fetcher, env: {} };
    await runAutoAdd(input);
    const before = calls.length;
    await runAutoAdd({ ...input, now: new Date(NOW.getTime() + 60 * 60_000) });
    expect(calls.length).toBe(before);
  });

  it("「新サービス：」の Issue が閉じたら調べる。下限の時間の中なら、たった後の同期で1回だけ調べる", async () => {
    const { fetcher, calls } = fakeGitHub(WATCHED, []);
    const input = { token: TOKEN, login: "gaku", settingsRepo: SETTINGS, fetcher, env: {} };
    await runAutoAdd({ ...input, results: results([{ updatedAt: "2026-11-16T02:00:00Z" }]), now: NOW });
    const graphqlCount = () => calls.filter((c) => c.path === "/graphql").length;
    expect(graphqlCount()).toBe(1);

    const closed = results([{ updatedAt: "2026-11-16T03:01:00Z", state: "closed" }]);
    await runAutoAdd({ ...input, results: closed, now: new Date(NOW.getTime() + 60_000) });
    expect(graphqlCount()).toBe(1);
    await runAutoAdd({ ...input, results: closed, now: new Date(NOW.getTime() + AUTO_ADD_MIN_INTERVAL_MS) });
    expect(graphqlCount()).toBe(2);
    await runAutoAdd({ ...input, results: closed, now: new Date(NOW.getTime() + 2 * AUTO_ADD_MIN_INTERVAL_MS) });
    expect(graphqlCount()).toBe(2);
  });

  it("手で押す「同期」はきっかけになる", async () => {
    const { fetcher, calls } = fakeGitHub(WATCHED, []);
    const input = { token: TOKEN, login: "gaku", settingsRepo: SETTINGS, results: results(), fetcher, env: {} };
    await runAutoAdd({ ...input, now: NOW });
    requestAutoAddCheck(SETTINGS);
    await runAutoAdd({ ...input, now: new Date(NOW.getTime() + AUTO_ADD_MIN_INTERVAL_MS) });
    expect(calls.filter((c) => c.path === "/graphql")).toHaveLength(2);
  });

  it("設定がオフなら足さない（リポジトリの一覧も読まない）", async () => {
    const { fetcher, store, calls } = fakeGitHub({ ...WATCHED, [AUTO_ADD_VARIABLE]: "off" }, OWNED);
    const added = await runAutoAdd({ token: TOKEN, login: "gaku", settingsRepo: SETTINGS, results: results(), now: NOW, fetcher, env: {} });
    expect(added).toEqual([]);
    expect(store[WATCHED_REPOS_VARIABLE]).toBe(WATCHED[WATCHED_REPOS_VARIABLE]);
    expect(calls.some((c) => c.path === "/graphql")).toBe(false);
  });

  it("外した物は足し直さない", async () => {
    const { fetcher, store } = fakeGitHub({ ...WATCHED, [REMOVED_REPOS_VARIABLE]: "gaku/morning-card" }, OWNED);
    const added = await runAutoAdd({ token: TOKEN, login: "gaku", settingsRepo: SETTINGS, results: results(), now: NOW, fetcher, env: {} });
    expect(added).toEqual([]);
    expect(store[WATCHED_REPOS_VARIABLE]).toBe(WATCHED[WATCHED_REPOS_VARIABLE]);
    expect(store[AUTO_ADDED_VARIABLE]).toBeUndefined();
  });

  it("保存先の一覧が無いときは、環境変数の一覧に足して保存する", async () => {
    const { fetcher, store } = fakeGitHub({}, OWNED);
    await runAutoAdd({
      token: TOKEN,
      login: "gaku",
      settingsRepo: SETTINGS,
      results: results(),
      now: NOW,
      fetcher,
      env: { WATCHED_REPOS: "gaku/agent-desk,gaku/ai-dev-template" },
    });
    expect(store[WATCHED_REPOS_VARIABLE]).toBe("gaku/agent-desk,gaku/ai-dev-template,gaku/morning-card");
  });
});

describe("loadAddedLog", () => {
  beforeEach(() => {
    autoAddStateForTest.clear();
    etagCacheForTest.clear();
  });

  it("テンプレートが無ければ読まない。読んだ物は5分覚える", async () => {
    const { fetcher, calls } = fakeGitHub({ [AUTO_ADDED_VARIABLE]: "gaku/morning-card@2026-11-16T02:00:00Z" }, []);
    const input = { token: TOKEN, settingsRepo: SETTINGS, now: NOW, fetcher };
    expect(await loadAddedLog({ ...input, results: [results()[0]] })).toEqual([]);
    expect(calls).toEqual([]);
    expect(await loadAddedLog({ ...input, results: results() })).toEqual([
      { repo: "gaku/morning-card", at: "2026-11-16T02:00:00.000Z" },
    ]);
    await loadAddedLog({ ...input, results: results(), now: new Date(NOW.getTime() + 60_000) });
    expect(calls).toHaveLength(1);
  });
});

describe("parseOwnedRepos", () => {
  it("名前とテンプレートを読み、形の違う物は捨てる", () => {
    expect(
      parseOwnedRepos({
        viewer: {
          repositories: {
            nodes: [
              { nameWithOwner: "gaku/a", templateRepository: { nameWithOwner: "gaku/t" } },
              { nameWithOwner: "gaku/b", templateRepository: null },
              { nameWithOwner: 1 },
              null,
            ],
          },
        },
      }),
    ).toEqual([
      { name: "gaku/a", template: "gaku/t" },
      { name: "gaku/b", template: null },
    ]);
    expect(parseOwnedRepos(null)).toEqual([]);
  });
});
