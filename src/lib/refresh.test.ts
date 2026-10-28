import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  formatResetTime,
  formatSyncTime,
  getAutoRefreshPlan,
  BUSY_REFRESH_INTERVAL_MS,
  getDisplayedSyncTime,
  getRefreshIntervalMs,
  hasAiTurnWork,
  IDLE_REFRESH_INTERVAL_MS,
  isFastRefresh,
  startAutoRefresh,
  type VisibilitySource,
} from "./refresh";
import type { RepoResult } from "./github/types";

describe("formatSyncTime", () => {
  it("日本時間の時:分:秒で出す", () => {
    expect(formatSyncTime(new Date("2026-10-25T06:42:10Z"))).toBe("15:42:10");
    expect(formatSyncTime(new Date("2026-10-24T15:00:05Z"))).toBe("00:00:05");
  });
});

class FakeDocument implements VisibilitySource {
  hidden = false;
  private listeners = new Set<() => void>();
  addEventListener(_type: "visibilitychange", listener: () => void) {
    this.listeners.add(listener);
  }
  removeEventListener(_type: "visibilitychange", listener: () => void) {
    this.listeners.delete(listener);
  }
  get listenerCount() {
    return this.listeners.size;
  }
  setHidden(hidden: boolean) {
    this.hidden = hidden;
    for (const listener of [...this.listeners]) listener();
  }
}

describe("getDisplayedSyncTime", () => {
  it("最後に取り直した時刻を出す（現在時刻では進めない）", () => {
    const syncedAt = new Date("2026-10-27T08:19:17Z");
    expect(getDisplayedSyncTime(syncedAt)).toBe(syncedAt);
  });
});

describe("startAutoRefresh", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("既定の間隔は30秒", () => {
    expect(IDLE_REFRESH_INTERVAL_MS).toBe(30_000);
  });

  it("指定した間隔ごとに取り直す", () => {
    const refresh = vi.fn();
    startAutoRefresh({ refresh, source: new FakeDocument(), intervalMs: 30_000 });

    vi.advanceTimersByTime(29_999);
    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60_000);
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it("タブが非表示の間は取り直さない", () => {
    const refresh = vi.fn();
    const source = new FakeDocument();
    startAutoRefresh({ refresh, source });

    source.setHidden(true);
    vi.advanceTimersByTime(5 * 60_000);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("最初から非表示なら動かさず、表示に戻ったらすぐ1回取り直して数え直す", () => {
    const refresh = vi.fn();
    const source = new FakeDocument();
    source.hidden = true;
    startAutoRefresh({ refresh, source });

    vi.advanceTimersByTime(IDLE_REFRESH_INTERVAL_MS);
    expect(refresh).not.toHaveBeenCalled();

    source.setHidden(false);
    expect(refresh).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(IDLE_REFRESH_INTERVAL_MS);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("止めると、タイマーも監視も外れる", () => {
    const refresh = vi.fn();
    const source = new FakeDocument();
    const stop = startAutoRefresh({ refresh, source });

    stop();
    vi.advanceTimersByTime(120_000);
    expect(refresh).not.toHaveBeenCalled();
    expect(source.listenerCount).toBe(0);
  });

  it("間隔を変えて起動し直すと、新しい間隔で取り直す", () => {
    const refresh = vi.fn();
    const source = new FakeDocument();
    const stopBusy = startAutoRefresh({ refresh, source, intervalMs: BUSY_REFRESH_INTERVAL_MS });
    vi.advanceTimersByTime(10_000);
    expect(refresh).toHaveBeenCalledTimes(1);

    stopBusy();
    startAutoRefresh({ refresh, source, intervalMs: IDLE_REFRESH_INTERVAL_MS });
    vi.advanceTimersByTime(29_999);
    expect(refresh).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(refresh).toHaveBeenCalledTimes(2);
  });
});

describe("getRefreshIntervalMs", () => {
  it("AIの番の作業があれば10秒、無ければ30秒", () => {
    expect(getRefreshIntervalMs(true)).toBe(BUSY_REFRESH_INTERVAL_MS);
    expect(getRefreshIntervalMs(true)).toBe(10_000);
    expect(getRefreshIntervalMs(false)).toBe(IDLE_REFRESH_INTERVAL_MS);
    expect(getRefreshIntervalMs(false)).toBe(30_000);
  });
});

describe("getAutoRefreshPlan", () => {
  const now = new Date("2026-10-28T06:00:00Z");
  const future = now.getTime() / 1000 + 1800;
  const plan = (hasAiWork: boolean, remaining: number | null, resetAt: number | null) =>
    getAutoRefreshPlan({ hasAiWork, remaining, resetAt, now });

  it("残りが1,500以上なら普段の間隔（作業の有無で10秒／30秒）", () => {
    expect(plan(true, 1500, future)).toEqual({ intervalMs: 10_000, resumeAt: null });
    expect(plan(false, 1500, future)).toEqual({ intervalMs: 30_000, resumeAt: null });
    expect(plan(true, 5000, future)).toEqual({ intervalMs: 10_000, resumeAt: null });
  });

  it("残りが1,500未満500以上なら60秒（作業の有無によらない）", () => {
    expect(plan(true, 1499, future)).toEqual({ intervalMs: 60_000, resumeAt: null });
    expect(plan(false, 500, future)).toEqual({ intervalMs: 60_000, resumeAt: null });
  });

  it("残りが500未満なら回復する時刻まで取り直さない", () => {
    expect(plan(true, 499, future)).toEqual({
      intervalMs: null,
      resumeAt: new Date(future * 1000),
    });
    expect(plan(false, 0, future).intervalMs).toBeNull();
  });

  it("回復する時刻を過ぎたら、残りは古いので普段の間隔に戻る", () => {
    const past = now.getTime() / 1000 - 1;
    expect(plan(true, 10, past)).toEqual({ intervalMs: 10_000, resumeAt: null });
    expect(plan(false, 1000, past)).toEqual({ intervalMs: 30_000, resumeAt: null });
    // ちょうどその時刻も過ぎた扱い
    expect(plan(false, 10, now.getTime() / 1000).intervalMs).toBe(30_000);
  });

  it("残りが不明なら普段の間隔", () => {
    expect(plan(true, null, null)).toEqual({ intervalMs: 10_000, resumeAt: null });
    expect(plan(false, null, future)).toEqual({ intervalMs: 30_000, resumeAt: null });
  });

  it("残りが少なくて回復する時刻が不明なら、止めずに60秒", () => {
    expect(plan(true, 10, null)).toEqual({ intervalMs: 60_000, resumeAt: null });
  });
});

describe("formatResetTime", () => {
  it("日本時間の時:分で出す（秒は落とす）", () => {
    expect(formatResetTime(Date.parse("2026-10-28T06:42:59Z") / 1000)).toBe("15:42");
    expect(formatResetTime(Date.parse("2026-10-28T15:00:00Z") / 1000)).toBe("00:00");
  });
});

describe("isFastRefresh", () => {
  it("10秒ごとの間だけ速い更新", () => {
    expect(isFastRefresh(getRefreshIntervalMs(true))).toBe(true);
    expect(isFastRefresh(getRefreshIntervalMs(false))).toBe(false);
  });
});

describe("hasAiTurnWork", () => {
  const now = new Date("2026-10-25T12:00:00Z");
  const repo = (...labelSets: string[][]): RepoResult => ({
    owner: "o",
    repo: "r",
    ok: true,
    data: {
      issues: labelSets.map((labels, i) => ({
        number: i + 1,
        title: `Issue ${i + 1}`,
        body: "",
        state: "open" as const,
        labels,
        url: "",
        createdAt: "2026-10-25T10:00:00Z",
        updatedAt: "2026-10-25T10:00:00Z",
        closedAt: null,
      })),
      pulls: [],
      comments: [],
      pullChecks: {},
      events: [],
    },
  });

  it("企画中・AI作業中があれば true", () => {
    expect(hasAiTurnWork([repo(["ai:plan"])], now)).toBe(true);
    expect(hasAiTurnWork([repo([]), repo(["ai:implement"])], now)).toBe(true);
  });

  it("人間の番・順番待ちだけなら false", () => {
    expect(hasAiTurnWork([repo([], ["ai:queue"])], now)).toBe(false);
  });

  it("取れなかったリポジトリや空は false", () => {
    const failed: RepoResult = {
      owner: "o",
      repo: "x",
      ok: false,
      error: { kind: "other", message: "" },
    };
    expect(hasAiTurnWork([failed], now)).toBe(false);
    expect(hasAiTurnWork([], now)).toBe(false);
  });
});
