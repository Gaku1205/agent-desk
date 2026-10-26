import { beforeEach, describe, expect, it } from "vitest";
import { etagCacheForTest, GitHubClient, type Fetcher } from "./client";
import { hasPipeline, readVariable, WATCHED_REPOS_VARIABLE, writeVariable } from "./settings";

const target = { owner: "Gaku1205", repo: "agent-desk" };
const VARIABLE_URL =
  "https://api.github.com/repos/Gaku1205/agent-desk/actions/variables/AGENT_DESK_WATCHED_REPOS";

type Call = { url: string; method: string; body: unknown };

function fakeFetcher(respond: (call: Call) => Response): { fetcher: Fetcher; calls: Call[] } {
  const calls: Call[] = [];
  const fetcher: Fetcher = async (input, init) => {
    const call = {
      url: String(input),
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    return respond(call);
  };
  return { fetcher, calls };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

beforeEach(() => etagCacheForTest.clear());

describe("readVariable", () => {
  it("値を返し、無ければ null", async () => {
    const found = fakeFetcher(() => json({ name: WATCHED_REPOS_VARIABLE, value: "a/b" }));
    expect(
      await readVariable(new GitHubClient("t", found.fetcher), target, WATCHED_REPOS_VARIABLE),
    ).toBe("a/b");
    expect(found.calls[0].url).toBe(VARIABLE_URL);

    const missing = fakeFetcher(() => json({ message: "Not Found" }, 404));
    expect(
      await readVariable(new GitHubClient("t", missing.fetcher), target, WATCHED_REPOS_VARIABLE),
    ).toBeNull();
  });
});

describe("writeVariable", () => {
  it("Variable が無ければ POST で作る", async () => {
    const { fetcher, calls } = fakeFetcher((call) =>
      call.method === "GET" ? json({}, 404) : new Response(null, { status: 201 }),
    );
    await writeVariable(new GitHubClient("t", fetcher), target, WATCHED_REPOS_VARIABLE, "a/b");
    expect(calls[1]).toEqual({
      url: "https://api.github.com/repos/Gaku1205/agent-desk/actions/variables",
      method: "POST",
      body: { name: WATCHED_REPOS_VARIABLE, value: "a/b" },
    });
  });

  it("Variable があれば PATCH で変える", async () => {
    const { fetcher, calls } = fakeFetcher((call) =>
      call.method === "GET" ? json({ value: "x/y" }) : new Response(null, { status: 204 }),
    );
    await writeVariable(new GitHubClient("t", fetcher), target, WATCHED_REPOS_VARIABLE, "a/b,c/d");
    expect(calls[1]).toEqual({
      url: VARIABLE_URL,
      method: "PATCH",
      body: { name: WATCHED_REPOS_VARIABLE, value: "a/b,c/d" },
    });
  });

  it("権限が無ければ 403 のエラーを投げる", async () => {
    const { fetcher } = fakeFetcher((call) =>
      call.method === "GET" ? json({}, 404) : json({ message: "Forbidden" }, 403),
    );
    await expect(
      writeVariable(new GitHubClient("t", fetcher), target, WATCHED_REPOS_VARIABLE, "a/b"),
    ).rejects.toMatchObject({ kind: "forbidden", status: 403 });
  });
});

describe("hasPipeline", () => {
  it("pipeline.yml があれば true、無ければ false", async () => {
    const yes = fakeFetcher(() => json({ type: "file" }));
    expect(await hasPipeline(new GitHubClient("t", yes.fetcher), target)).toBe(true);
    expect(yes.calls[0].url).toBe(
      "https://api.github.com/repos/Gaku1205/agent-desk/contents/.github/workflows/pipeline.yml",
    );
    const no = fakeFetcher(() => json({}, 404));
    expect(await hasPipeline(new GitHubClient("t", no.fetcher), target)).toBe(false);
  });
});
