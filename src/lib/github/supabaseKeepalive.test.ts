import { beforeEach, describe, expect, it } from "vitest";
import { clearCpuMemoForTest, loadCpuTotals } from "./cpuUsage";
import { clearSupabaseMemoForTest, loadSupabaseKeepalives } from "./supabaseKeepalive";

const NOW = Date.parse("2026-11-20T20:43:00Z");

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** URL ごとの返事を決める偽の fetch。呼ばれた URL を残す */
function fakeFetch(answer: (url: string) => Response) {
  const calls: string[] = [];
  const fetcher = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    return answer(url);
  }) as typeof fetch;
  return { fetcher, calls };
}

const REPOS = [
  { owner: "o", repo: "tide-almanac" },
  { owner: "o", repo: "loss-lab" },
  { owner: "o", repo: "no-supabase" },
];

function answer(url: string): Response {
  if (url.includes("/no-supabase/")) return json({ message: "Not Found" }, 404);
  if (url.includes("/tide-almanac/actions/workflows/")) {
    return json({ workflow_runs: [{ id: 1, conclusion: "success", created_at: "2026-11-20T20:43:00Z", html_url: "h1" }] });
  }
  if (url.includes("/loss-lab/actions/workflows/")) {
    return json({
      workflow_runs: [
        { id: 9, conclusion: "failure", created_at: "2026-11-20T20:00:00Z", html_url: "https://github.com/o/loss-lab/actions/runs/9" },
        { id: 8, conclusion: "failure", created_at: "2026-11-18T20:00:00Z", html_url: "h8" },
        { id: 7, conclusion: "success", created_at: "2026-11-17T20:00:00Z", html_url: "h7" },
      ],
    });
  }
  if (url.includes("/loss-lab/actions/runs/9/jobs")) return json({ jobs: [{ id: 55, conclusion: "failure" }] });
  if (url.includes("/loss-lab/check-runs/55/annotations")) {
    return json([{ message: "Project is paused. Resume: https://supabase.com/dashboard/project/abc" }]);
  }
  return json({}, 500);
}

describe("loadSupabaseKeepalives", () => {
  beforeEach(() => clearSupabaseMemoForTest());

  it("見張りが無いリポジトリは入らず、失敗は注釈まで読む", async () => {
    const { fetcher } = fakeFetch(answer);
    const result = await loadSupabaseKeepalives({ token: "t-a", repos: REPOS, nowMs: NOW, fetcher });
    expect(result.map((r) => [r.repo, r.ok])).toEqual([
      ["tide-almanac", true],
      ["loss-lab", false],
    ]);
    expect(result[1]).toMatchObject({
      failingSince: Date.parse("2026-11-18T20:00:00Z"),
      message: "Project is paused. Resume: https://supabase.com/dashboard/project/abc",
      logUrl: "https://github.com/o/loss-lab/actions/runs/9",
    });
  });

  it("5分以内の2回目は GitHub を読まない（404 の「無い」も覚える）。5分を過ぎたら読み直す", async () => {
    const { fetcher, calls } = fakeFetch(answer);
    await loadSupabaseKeepalives({ token: "t-b", repos: REPOS, nowMs: NOW, fetcher });
    const first = calls.length;
    expect(first).toBeGreaterThan(0);
    const again = await loadSupabaseKeepalives({ token: "t-b", repos: REPOS, nowMs: NOW + 4 * 60 * 1000, fetcher });
    expect(calls.length).toBe(first);
    expect(again).toHaveLength(2);
    await loadSupabaseKeepalives({ token: "t-b", repos: REPOS, nowMs: NOW + 5 * 60 * 1000, fetcher });
    expect(calls.length).toBeGreaterThan(first);
  });

  it("失敗は覚えない", async () => {
    let fail = true;
    const { fetcher, calls } = fakeFetch((url) => (fail ? json({}, 500) : answer(url)));
    const repos = [REPOS[0]];
    expect(await loadSupabaseKeepalives({ token: "t-c", repos, nowMs: NOW, fetcher })).toEqual([]);
    fail = false;
    const result = await loadSupabaseKeepalives({ token: "t-c", repos, nowMs: NOW + 1000, fetcher });
    expect(result).toHaveLength(1);
    expect(calls).toHaveLength(2);
  });

  it("knownOnly のときは読まない", async () => {
    const { fetcher, calls } = fakeFetch(answer);
    expect(await loadSupabaseKeepalives({ token: "t-d", repos: REPOS, nowMs: NOW, knownOnly: true, fetcher })).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});

describe("loadCpuTotals", () => {
  beforeEach(() => clearCpuMemoForTest());

  it("使用量の Issue を読み、5分覚える", async () => {
    const { fetcher, calls } = fakeFetch(() =>
      json([
        { number: 3, title: "使用量：2026-11-21", body: "CPU時間（ms）：222000\n\n…" },
        { number: 2, title: "ほかの Issue", body: "" },
      ]),
    );
    const settingsRepo = { owner: "o", repo: "settings" };
    const totals = await loadCpuTotals({ token: "t", settingsRepo, nowMs: NOW, fetcher });
    expect(totals).toEqual(new Map([["2026-11-21", 222000]]));
    await loadCpuTotals({ token: "t", settingsRepo, nowMs: NOW + 60_000, fetcher });
    expect(calls).toHaveLength(1);
  });

  it("SETTINGS_REPO が無ければ null", async () => {
    expect(await loadCpuTotals({ token: "t", settingsRepo: null, nowMs: NOW })).toBeNull();
  });
});
