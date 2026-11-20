import { describe, expect, it } from "vitest";
import type { GithubLimits } from "./githubLimits";
import {
  buildServiceRows,
  CPU_LIMIT_MS,
  cpuForecast,
  cpuRecoveryDate,
  formatCpu,
  isPausedMessage,
  orderServiceRows,
  sinceWords,
  supabaseDashboardUrl,
  supabaseVerdict,
  type ServiceRow,
  type SupabaseKeepalive,
} from "./services";
import { recentDateKeys } from "../usage/cpuBudget";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
// 2026-11-21 05:43 JST
const NOW = new Date("2026-11-20T20:43:00Z");

function limits(pipeline: number | null, reads: number | null): GithubLimits {
  return {
    pipeline: { remaining: pipeline, limit: 5000, resetAt: null },
    reads: { remaining: reads, limit: 5000, resetAt: null },
    hourStarts: [],
    pipelineUsed: [],
    readsUsed: [],
    runs: null,
  };
}

function keepalive(repo: string, ok: boolean, message: string | null = null): SupabaseKeepalive {
  return {
    owner: "o",
    repo,
    ok,
    at: NOW.getTime() - HOUR,
    failingSince: ok ? null : NOW.getTime() - 2 * DAY - HOUR,
    message,
    logUrl: `https://github.com/o/${repo}/actions/runs/1`,
  };
}

describe("sinceWords", () => {
  it("24時間以上は日、1時間以上は時間、それ未満は分（切り捨て・最小1分）", () => {
    const now = NOW.getTime();
    expect(sinceWords(now - 2 * DAY - 5 * HOUR, now)).toBe("2日前から");
    expect(sinceWords(now - DAY, now)).toBe("1日前から");
    expect(sinceWords(now - DAY + 1, now)).toBe("23時間前から");
    expect(sinceWords(now - 3 * HOUR, now)).toBe("3時間前から");
    expect(sinceWords(now - 12 * 60 * 1000, now)).toBe("12分前から");
    expect(sinceWords(now - 1000, now)).toBe("1分前から");
    expect(sinceWords(now + 1000, now)).toBe("1分前から");
  });
});

describe("supabaseVerdict", () => {
  it("成功・失敗以外は飛ばし、続けて失敗しているいちばん古い時刻を返す", () => {
    const runs = [
      { id: 4, conclusion: "cancelled", createdAt: 400, htmlUrl: null },
      { id: 3, conclusion: "failure", createdAt: 300, htmlUrl: null },
      { id: 2, conclusion: "timed_out", createdAt: 200, htmlUrl: null },
      { id: 1, conclusion: "success", createdAt: 100, htmlUrl: null },
    ];
    expect(supabaseVerdict(runs)).toEqual({ ok: false, latest: runs[1], failingSince: 200 });
  });
  it("いちばん新しい物が成功ならよい", () => {
    const runs = [{ id: 1, conclusion: "success", createdAt: 100, htmlUrl: null }];
    expect(supabaseVerdict(runs)?.ok).toBe(true);
  });
  it("決められなければ null", () => {
    expect(supabaseVerdict([])).toBeNull();
    expect(supabaseVerdict([{ id: 1, conclusion: "skipped", createdAt: 1, htmlUrl: null }])).toBeNull();
  });
});

describe("失敗の文", () => {
  it("paused・一時停止を一時停止とみなす", () => {
    expect(isPausedMessage("Project is PAUSED")).toBe(true);
    expect(isPausedMessage("プロジェクトが一時停止しています")).toBe(true);
    expect(isPausedMessage("HTTP 500")).toBe(false);
    expect(isPausedMessage(null)).toBe(false);
  });
  it("ダッシュボードのリンクを取る", () => {
    expect(supabaseDashboardUrl("see https://supabase.com/dashboard/project/abc123 now")).toBe(
      "https://supabase.com/dashboard/project/abc123",
    );
    expect(supabaseDashboardUrl("nothing")).toBeNull();
  });
});

describe("formatCpu", () => {
  it("書き方", () => {
    expect(formatCpu(3 * 60 * 1000 + 42 * 1000)).toBe("3m42s");
    expect(formatCpu(3 * 60 * 1000)).toBe("3m");
    expect(formatCpu(20 * 1000)).toBe("20s");
    expect(formatCpu(2 * HOUR + 50 * 60 * 1000)).toBe("2h 50m");
    expect(formatCpu(4 * HOUR)).toBe("4h");
  });
});

describe("cpuForecast", () => {
  it("このままなら30日で＝今日の分×30。30日より古い日は入れない", () => {
    const keys = recentDateKeys(NOW, 31);
    const totals = new Map([
      [keys[0], 222_000],
      [keys[1], 600_000],
      [keys[30], 9_999_999],
    ]);
    const forecast = cpuForecast(totals, NOW);
    expect(forecast.todayMs).toBe(222_000);
    expect(forecast.totalMs).toBe(822_000);
    expect(forecast.projectedMs).toBe(222_000 * 30);
    expect(formatCpu(forecast.projectedMs)).toBe("1h 51m");
    expect(forecast.bad).toBe(false);
  });
  it("上限の90%ちょうどは悪くない、超えたら悪い", () => {
    const keys = recentDateKeys(NOW, 30);
    expect(cpuForecast(new Map([[keys[3], CPU_LIMIT_MS * 0.9]]), NOW).bad).toBe(false);
    expect(cpuForecast(new Map([[keys[3], CPU_LIMIT_MS * 0.9 + 1]]), NOW).bad).toBe(true);
  });
});

describe("cpuRecoveryDate", () => {
  it("古い日が窓から出て、90%以下になる最初の日", () => {
    const keys = recentDateKeys(NOW, 30);
    // いちばん古い日（29日前）に大きな使用。1日後に窓から出る
    const totals = new Map([
      [keys[29], 3 * HOUR],
      [keys[0], HOUR],
    ]);
    expect(cpuRecoveryDate(totals, NOW)).toBe("11/22");
    // 28日前の大きな使用は2日後に出る
    const later = new Map([
      [keys[29], 10 * 60 * 1000],
      [keys[28], 4 * HOUR],
    ]);
    expect(cpuRecoveryDate(later, NOW)).toBe("11/23");
  });
  it("超えていなければ null", () => {
    expect(cpuRecoveryDate(new Map(), NOW)).toBeNull();
  });
});

describe("orderServiceRows", () => {
  const row = (key: string, kind: ServiceRow["kind"], state: ServiceRow["state"]): ServiceRow => ({
    key,
    kind,
    state,
    name: key,
    main: "",
    sub: null,
    bar: null,
    right: null,
  });
  it("全部よければ Supabase → Vercel → GitHub", () => {
    const rows = [row("g", "github", "ok"), row("v", "vercel", "ok"), row("s1", "supabase", "ok"), row("s2", "supabase", "ok")];
    expect(orderServiceRows(rows).map((r) => r.key)).toEqual(["s1", "s2", "v", "g"]);
  });
  it("悪い物が上", () => {
    const rows = [row("s1", "supabase", "ok"), row("s2", "supabase", "bad"), row("v", "vercel", "unknown"), row("g", "github", "bad")];
    expect(orderServiceRows(rows).map((r) => r.key)).toEqual(["s2", "g", "s1", "v"]);
  });
});

describe("buildServiceRows", () => {
  it("Supabase の失敗が上で、文言・リンクが付く", () => {
    const rows = buildServiceRows({
      supabase: [
        keepalive("tide-almanac", true),
        keepalive("loss-lab", false, "Project paused: https://supabase.com/dashboard/project/xyz"),
        keepalive("other", false, "HTTP 500"),
      ],
      cpuTotals: new Map(),
      limits: limits(3912, 4620),
      now: NOW,
    });
    expect(rows.map((r) => r.key)).toEqual(["supabase:o/loss-lab", "supabase:o/other", "supabase:o/tide-almanac", "vercel", "github"]);
    expect(rows[0]).toMatchObject({
      state: "bad",
      main: "loss-lab が一時停止しています",
      sub: "2日前から",
      right: { text: "Resume を開く →", href: "https://supabase.com/dashboard/project/xyz" },
    });
    expect(rows[1]).toMatchObject({
      main: "Supabase に書き込めませんでした",
      right: { text: "実行のログを開く →", href: "https://github.com/o/other/actions/runs/1" },
    });
    expect(rows[2].main).toBe("tide-almanac · 最後に起こした 04:43");
    expect(rows[4].main).toBe("Pipeline 残り 3,912 / 5,000 · reads 残り 4,620 / 5,000");
  });
  it("GitHub の上限の90%を超えたら悪い。Vercel が読めなければ分からない", () => {
    const rows = buildServiceRows({ supabase: [], cpuTotals: null, limits: limits(4000, 400), now: NOW });
    expect(rows.map((r) => [r.key, r.state])).toEqual([
      ["github", "bad"],
      ["vercel", "unknown"],
    ]);
    expect(rows[0].bar).toBeCloseTo(0.92);
  });
  it("Vercel が上限の90%を超えたら、戻る日を出す", () => {
    const keys = recentDateKeys(NOW, 30);
    const rows = buildServiceRows({
      supabase: [],
      cpuTotals: new Map([
        [keys[0], 222_000],
        [keys[29], 4 * HOUR],
      ]),
      limits: limits(null, null),
      now: NOW,
    });
    expect(rows[0]).toMatchObject({
      key: "vercel",
      state: "bad",
      main: "30日で 4h 3m / 4h",
      sub: "今日 3m42s · このままなら 30日で 1h 51m",
      right: { text: "11/22 に戻る見込み", href: null },
      bar: 1,
    });
    expect(rows[1]).toMatchObject({ key: "github", state: "unknown", bar: null });
  });
});
