import { beforeEach, describe, expect, it } from "vitest";
import { etagCacheForTest, GitHubClient, type Fetcher } from "./client";
import { DEFAULT_PARALLEL_SETTINGS } from "../parallel";
import {
  hasPipeline,
  lookupPipeline,
  readParallelOverride,
  readParallelSettings,
  readVariable,
  WATCHED_REPOS_VARIABLE,
  writeParallelOverride,
  writeParallelSettings,
  writeVariable,
} from "./settings";

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

describe("並列の設定", () => {
  const BASE = "https://api.github.com/repos/Gaku1205/agent-desk/actions/variables";

  it("読む：無い・不正な値は既定", async () => {
    const values: Record<string, string> = { PARALLEL_DAY: "6", PARALLEL_NIGHT: "0" };
    const { fetcher, calls } = fakeFetcher((call) => {
      const name = call.url.slice(BASE.length + 1);
      return name in values ? json({ name, value: values[name] }) : json({}, 404);
    });
    expect(await readParallelSettings(new GitHubClient("t", fetcher), target)).toEqual({
      day: 6,
      night: 1,
      nightHours: null,
    });
    expect(calls.map((c) => c.url.slice(BASE.length + 1)).sort()).toEqual([
      "PARALLEL_DAY",
      "PARALLEL_NIGHT",
      "PARALLEL_NIGHT_HOURS",
    ]);
  });

  it("書く：既定と違う値は書き、既定と同じ・無しは消す。TZ・OVERRIDE には触らない", async () => {
    const existing = new Set(["PARALLEL_NIGHT", "PARALLEL_NIGHT_HOURS"]);
    const { fetcher, calls } = fakeFetcher((call) => {
      const name = call.url.slice(BASE.length + 1);
      if (call.method === "GET") return existing.has(name) ? json({ value: "x" }) : json({}, 404);
      return new Response(null, { status: 204 });
    });
    // 昼5（書く・新規）、夜1（既定＝消す）、夜の時間帯なし（消す）
    await writeParallelSettings(new GitHubClient("t", fetcher), target, {
      day: 5,
      night: 1,
      nightHours: null,
    });
    const writes = calls.filter((c) => c.method !== "GET");
    expect(writes).toEqual([
      { url: BASE, method: "POST", body: { name: "PARALLEL_DAY", value: "5" } },
      { url: `${BASE}/PARALLEL_NIGHT`, method: "DELETE", body: undefined },
      { url: `${BASE}/PARALLEL_NIGHT_HOURS`, method: "DELETE", body: undefined },
    ]);
    expect(calls.some((c) => /PARALLEL_(TZ|OVERRIDE)/.test(c.url))).toBe(false);
  });

  it("書く：すでに無い Variable を消そうとしても失敗しない（404）", async () => {
    const { fetcher } = fakeFetcher(() => json({}, 404));
    await expect(
      writeParallelSettings(new GitHubClient("t", fetcher), target, DEFAULT_PARALLEL_SETTINGS),
    ).resolves.toBeUndefined();
  });

  it("書く：権限が無ければ 403 のエラーを投げる", async () => {
    const { fetcher } = fakeFetcher((call) =>
      call.method === "GET" ? json({}, 404) : json({ message: "Forbidden" }, 403),
    );
    await expect(
      writeParallelSettings(new GitHubClient("t", fetcher), target, { day: 5, night: 2, nightHours: null }),
    ).rejects.toMatchObject({ kind: "forbidden", status: 403 });
  });
});

describe("並列の手の上書き", () => {
  const BASE = "https://api.github.com/repos/Gaku1205/agent-desk/actions/variables";

  it("書く：PARALLEL_OVERRIDE だけを作る（ほかの並列の変数には触らない）", async () => {
    const { fetcher, calls } = fakeFetcher((call) =>
      call.method === "GET" ? json({}, 404) : new Response(null, { status: 201 }),
    );
    await writeParallelOverride(new GitHubClient("t", fetcher), target, "night until 2026-11-18T08:00+09:00");
    expect(calls.filter((c) => c.method !== "GET")).toEqual([
      { url: BASE, method: "POST", body: { name: "PARALLEL_OVERRIDE", value: "night until 2026-11-18T08:00+09:00" } },
    ]);
  });

  it("書く：null なら消す（無くても失敗しない）", async () => {
    const { fetcher, calls } = fakeFetcher(() => json({}, 404));
    await writeParallelOverride(new GitHubClient("t", fetcher), target, null);
    expect(calls).toEqual([{ url: `${BASE}/PARALLEL_OVERRIDE`, method: "DELETE", body: undefined }]);
  });

  it("読む：値を返し、無ければ null", async () => {
    const found = fakeFetcher(() => json({ value: "day until 2026-11-18T08:00+09:00" }));
    expect(await readParallelOverride(new GitHubClient("t", found.fetcher), target)).toBe(
      "day until 2026-11-18T08:00+09:00",
    );
    const missing = fakeFetcher(() => json({}, 404));
    expect(await readParallelOverride(new GitHubClient("t", missing.fetcher), target)).toBeNull();
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

describe("lookupPipeline", () => {
  it("あり→true、404→false、通信失敗・レート制限→null（分からない）", async () => {
    const yes = fakeFetcher(() => json({ type: "file" }));
    expect(await lookupPipeline(new GitHubClient("t", yes.fetcher), target)).toBe(true);
    const no = fakeFetcher(() => json({}, 404));
    expect(await lookupPipeline(new GitHubClient("t", no.fetcher), target)).toBe(false);
    const broken = fakeFetcher(() => json({}, 500));
    expect(await lookupPipeline(new GitHubClient("t", broken.fetcher), target)).toBeNull();
    const limited = fakeFetcher(() => new Response("{}", { status: 429 }));
    expect(await lookupPipeline(new GitHubClient("t", limited.fetcher), target)).toBeNull();
  });
});
