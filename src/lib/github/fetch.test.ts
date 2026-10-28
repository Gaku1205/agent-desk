import { beforeEach, describe, expect, it } from "vitest";
import {
  ETAG_CACHE_MAX_ENTRIES,
  etagCacheForTest,
  GitHubClient,
  parseNextLink,
} from "./client";
import { classifyError, GitHubError } from "./errors";
import { fetchAllRepos } from "./fetch";

const TOKEN = "ghp_secret_token_value";
const NOW = new Date("2026-10-25T00:00:00Z");

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

describe("classifyError", () => {
  it("ステータスごとに種類を分ける", () => {
    expect(classifyError(401, new Headers())).toBe("unauthorized");
    expect(classifyError(403, new Headers())).toBe("forbidden");
    expect(classifyError(404, new Headers())).toBe("not_found");
    expect(classifyError(429, new Headers())).toBe("rate_limited");
    expect(classifyError(500, new Headers())).toBe("other");
  });

  it("403でも残り回数が0ならレート制限", () => {
    expect(classifyError(403, new Headers({ "x-ratelimit-remaining": "0" }))).toBe(
      "rate_limited",
    );
    expect(classifyError(403, new Headers({ "retry-after": "60" }))).toBe("rate_limited");
  });
});

describe("GitHubClient", () => {
  it("認証ヘッダーを付けて呼ぶ", async () => {
    let seen: Headers | undefined;
    const client = new GitHubClient(TOKEN, async (_url, init) => {
      seen = new Headers(init?.headers);
      return json({ ok: true });
    });
    await client.get("/repos/o/r/issues");
    expect(seen?.get("authorization")).toBe(`Bearer ${TOKEN}`);
  });

  it.each([
    [401, "unauthorized", "認証が切れ"],
    [403, "forbidden", "権限がありません"],
    [404, "not_found", "見つかりません"],
    [429, "rate_limited", "レート制限"],
    [500, "other", "取れませんでした"],
  ])("%i は %s のエラーになる（日本語の理由、トークンなし）", async (status, kind, text) => {
    const client = new GitHubClient(TOKEN, async () =>
      json({ message: `bad ${TOKEN}` }, { status }),
    );
    const error = await client.get("/x").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GitHubError);
    const e = error as GitHubError;
    expect(e.kind).toBe(kind);
    expect(e.message).toContain(text);
    expect(e.message).not.toContain(TOKEN);
  });

  it("通信エラーは other で、元のエラー文（トークンを含みうる）を引き継がない", async () => {
    const client = new GitHubClient(TOKEN, async () => {
      throw new Error(`failed with ${TOKEN}`);
    });
    const e = (await client.get("/x").catch((err: unknown) => err)) as GitHubError;
    expect(e.kind).toBe("other");
    expect(e.message).not.toContain(TOKEN);
  });

  it("Link ヘッダーの次のページまで取る", async () => {
    const urls: string[] = [];
    const client = new GitHubClient(TOKEN, async (url) => {
      urls.push(String(url));
      if (urls.length === 1) {
        return json([1], {
          headers: { link: '<https://api.github.com/p2>; rel="next"' },
        });
      }
      return json([2]);
    });
    expect(await client.getAll<number>("/p1")).toEqual([1, 2]);
    expect(urls).toEqual(["https://api.github.com/p1", "https://api.github.com/p2"]);
  });
});

describe("GitHubClient のETag", () => {
  beforeEach(() => etagCacheForTest.clear());

  it("2回目から If-None-Match を付け、304 のときは前回の中身と次ページを使う", async () => {
    const seen: (string | null)[] = [];
    const client = new GitHubClient(TOKEN, async (_url, init) => {
      const inm = new Headers(init?.headers).get("if-none-match");
      seen.push(inm);
      if (inm === '"v1"') return new Response(null, { status: 304 });
      return json([1], {
        headers: { etag: '"v1"', link: '<https://api.github.com/p2>; rel="next"' },
      });
    });
    const first = await client.request("/p1");
    const second = await client.request("/p1");
    expect(seen).toEqual([null, '"v1"']);
    expect(second).toEqual(first);
    expect(second).toEqual({ json: [1], next: "https://api.github.com/p2" });
  });

  it("内容が変わっていれば新しい中身と新しいETagに替わる", async () => {
    let n = 0;
    const seen: (string | null)[] = [];
    const client = new GitHubClient(TOKEN, async (_url, init) => {
      seen.push(new Headers(init?.headers).get("if-none-match"));
      n++;
      return json({ n }, { headers: { etag: `"v${n}"` } });
    });
    await client.get("/x");
    expect(await client.get("/x")).toEqual({ n: 2 });
    await client.get("/x");
    expect(seen).toEqual([null, '"v1"', '"v2"']);
  });

  it("キーにトークンそのものは入らず、トークンが違えば別に覚える", async () => {
    const fetcher: typeof fetch = async () => json([], { headers: { etag: '"a"' } });
    await new GitHubClient(TOKEN, fetcher).get("/x");
    await new GitHubClient("other_token", fetcher).get("/x");
    const keys = etagCacheForTest.keys();
    expect(keys).toHaveLength(2);
    for (const key of keys) {
      expect(key).not.toContain(TOKEN);
      expect(key).not.toContain("other_token");
    }
  });

  it("覚える件数には上限がある", async () => {
    const client = new GitHubClient(TOKEN, async () => json([], { headers: { etag: '"a"' } }));
    for (let i = 0; i < ETAG_CACHE_MAX_ENTRIES + 10; i++) await client.get(`/x/${i}`);
    expect(etagCacheForTest.keys()).toHaveLength(ETAG_CACHE_MAX_ENTRIES);
  });

  it("書き込み（send）には If-None-Match を付けない", async () => {
    let inm: string | null = "unset";
    await new GitHubClient(TOKEN, async (_url, init) => {
      if (init?.method === "POST") inm = new Headers(init.headers).get("if-none-match");
      return json({}, { headers: { etag: '"a"' } });
    }).send("POST", "/x", {});
    expect(inm).toBeNull();
  });
});

describe("parseNextLink", () => {
  it("GitHub以外のURLは辿らない", () => {
    expect(parseNextLink('<https://evil.example/x>; rel="next"')).toBeNull();
    expect(parseNextLink(null)).toBeNull();
  });
});

/** リポジトリ `ok/repo` はデータを返し、`ng/repo` は指定のステータスで失敗する偽のGitHub */
function fakeGitHub(failStatus: number, mainStatusFails = false): typeof fetch {
  return async (input) => {
    const path = new URL(String(input)).pathname;
    if (mainStatusFails && path.endsWith("/commits/main/status")) {
      return json({ message: "x" }, { status: 404 });
    }
    if (path.startsWith("/repos/ng/")) return json({ message: "x" }, { status: failStatus });
    if (path.endsWith("/issues")) {
      return json([
        {
          number: 1,
          title: "issue",
          state: "open",
          labels: [],
          html_url: "u",
          created_at: "2026-10-20T00:00:00Z",
          updated_at: "2026-10-20T00:00:00Z",
        },
        {
          number: 2,
          title: "pr as issue",
          state: "open",
          pull_request: {},
          html_url: "u",
          created_at: "2026-10-20T00:00:00Z",
          updated_at: "2026-10-20T00:00:00Z",
        },
      ]);
    }
    if (path.endsWith("/pulls")) {
      return json([
        {
          number: 2,
          title: "pr",
          state: "closed",
          merged_at: "2026-10-21T00:00:00Z",
          html_url: "u",
          head: { ref: "claude/issue-1-x", sha: "headsha" },
          merge_commit_sha: "mergesha",
          created_at: "2026-10-20T00:00:00Z",
          updated_at: "2026-10-21T00:00:00Z",
        },
        {
          number: 9,
          title: "old",
          state: "closed",
          html_url: "u",
          head: { ref: "b", sha: "oldsha" },
          created_at: "2026-09-01T00:00:00Z",
          updated_at: "2026-09-01T00:00:00Z",
        },
      ]);
    }
    if (path.endsWith("/issues/comments")) return json([]);
    if (path.endsWith("/issues/events")) {
      return json([
        { event: "labeled", label: { name: "ai:implement" }, issue: { number: 1 }, created_at: "t" },
      ]);
    }
    if (path.endsWith("/commits/headsha/check-runs")) {
      return json({
        check_runs: [
          {
            name: "test",
            status: "completed",
            conclusion: "success",
            app: { slug: "github-actions" },
            completed_at: "2026-10-20T01:00:00Z",
          },
        ],
      });
    }
    if (path.endsWith("/commits/mergesha/status")) {
      return json({
        statuses: [{ context: "Vercel", state: "success", updated_at: "2026-10-21T00:05:00Z" }],
      });
    }
    if (path.endsWith("/commits/main/status")) {
      return json({
        statuses: [{ context: "Vercel", state: "success", updated_at: "2026-10-21T01:00:00Z" }],
      });
    }
    return json({ message: "unexpected" }, { status: 500 });
  };
}

/** 取り直しのURLと If-None-Match を順に覚える */
type Seen = { url: string; inm: string | null };

/** fakeGitHub に ETag を付けたもの。同じ内容のあいだは If-None-Match に 304 を返す */
function etagGitHub(seen: Seen[]): typeof fetch {
  const base = fakeGitHub(404);
  return async (input, init) => {
    const inm = new Headers(init?.headers).get("if-none-match");
    seen.push({ url: String(input), inm });
    if (inm) return new Response(null, { status: 304 });
    const res = await base(input, init);
    if (!res.ok) return res;
    return new Response(res.body, {
      status: 200,
      headers: { "content-type": "application/json", etag: '"e"' },
    });
  };
}

function rawIssue(number: number, updatedAt: string) {
  return {
    number,
    title: `issue ${number}`,
    state: "open",
    labels: [],
    html_url: "u",
    created_at: "2026-10-01T00:00:00Z",
    updated_at: updatedAt,
  };
}

function rawComment(id: number, createdAt: string) {
  return {
    id,
    issue_url: "https://api.github.com/repos/ok/repo/issues/1",
    user: { login: "gaku" },
    body: "c",
    created_at: createdAt,
  };
}

describe("fetchAllRepos の since（日の始めに切り下げ）", () => {
  beforeEach(() => etagCacheForTest.clear());

  it("同じ日の中で時刻をずらして2回取り直すと、URL が同じで2回目に If-None-Match が付く", async () => {
    const seen: Seen[] = [];
    const fetcher = etagGitHub(seen);
    const repos = [{ owner: "ok", repo: "repo" }];
    await fetchAllRepos(TOKEN, repos, { fetcher, now: new Date("2026-10-25T01:00:00Z") });
    await fetchAllRepos(TOKEN, repos, { fetcher, now: new Date("2026-10-25T20:00:00Z") });

    const issueCalls = seen.filter((s) => new URL(s.url).pathname.endsWith("/issues"));
    const commentCalls = seen.filter((s) => new URL(s.url).pathname.endsWith("/issues/comments"));
    expect(issueCalls).toHaveLength(2);
    expect(commentCalls).toHaveLength(2);
    expect(new URL(issueCalls[0].url).searchParams.get("since")).toBe("2026-10-11T00:00:00.000Z");
    expect(issueCalls[1].url).toBe(issueCalls[0].url);
    expect(issueCalls[0].inm).toBeNull();
    expect(issueCalls[1].inm).toBe('"e"');
    expect(commentCalls[1].url).toBe(commentCalls[0].url);
    expect(commentCalls[1].inm).toBe('"e"');
  });

  it("14日より古い Issue（updatedAt）・コメント（createdAt）は、切り下げで返ってきても結果に入らない", async () => {
    const base = fakeGitHub(404);
    const fetcher: typeof fetch = async (input, init) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith("/issues")) {
        return json([rawIssue(1, "2026-10-20T00:00:00Z"), rawIssue(3, "2026-10-11T06:00:00Z")]);
      }
      if (path.endsWith("/issues/comments")) {
        return json([rawComment(10, "2026-10-11T06:00:00Z"), rawComment(11, "2026-10-12T00:00:00Z")]);
      }
      return base(input, init);
    };
    const [result] = await fetchAllRepos(TOKEN, [{ owner: "ok", repo: "repo" }], {
      fetcher,
      now: new Date("2026-10-25T12:00:00Z"),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.issues.map((i) => i.number)).toEqual([1]);
    expect(result.data.comments.map((c) => c.id)).toEqual([11]);
  });
});

describe("fetchAllRepos", () => {
  it("リポジトリのデータを自前の型にして返す", async () => {
    const [result] = await fetchAllRepos(TOKEN, [{ owner: "ok", repo: "repo" }], {
      fetcher: fakeGitHub(404),
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.issues.map((i) => i.number)).toEqual([1]);
    expect(result.data.pulls.map((p) => p.number)).toEqual([2]);
    expect(result.data.pullChecks[2].checkRuns[0].appSlug).toBe("github-actions");
    expect(result.data.pullChecks[2].statuses[0].updatedAt).toBe("2026-10-21T00:05:00Z");
    expect(result.data.events).toHaveLength(1);
  });

  it("main の公開ステータスが取れなくても、ほかのデータは取れる（公開の時刻は null）", async () => {
    const [result] = await fetchAllRepos(TOKEN, [{ owner: "ok", repo: "repo" }], {
      fetcher: fakeGitHub(404, true),
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.mainDeployedAt).toBeNull();
    expect(result.data.issues.map((i) => i.number)).toEqual([1]);
    expect(result.data.pulls.map((p) => p.number)).toEqual([2]);
  });

  it("1つのリポジトリが失敗しても、ほかは取れる", async () => {
    const results = await fetchAllRepos(
      TOKEN,
      [
        { owner: "ng", repo: "repo" },
        { owner: "ok", repo: "repo" },
      ],
      { fetcher: fakeGitHub(403), now: NOW },
    );
    const [failed, succeeded] = results;
    expect(failed.ok).toBe(false);
    if (!failed.ok) {
      expect(failed.error.kind).toBe("forbidden");
      expect(failed.error.message).not.toContain(TOKEN);
    }
    expect(succeeded.ok).toBe(true);
  });
});
