import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  formatSyncTime,
  BUSY_REFRESH_INTERVAL_MS,
  getDisplayedSyncTime,
  getRefreshIntervalMs,
  hasAiTurnWork,
  IDLE_REFRESH_INTERVAL_MS,
  isFastRefresh,
  LIVE_BUSY_REFRESH_INTERVAL_MS,
  LIVE_IDLE_REFRESH_INTERVAL_MS,
  LIVE_REFRESH_DEBOUNCE_MS,
  startAutoRefresh,
  startLiveRefresh,
  type LiveEventSource,
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
  const syncedAt = new Date("2026-10-27T08:19:17Z");
  const now = new Date("2026-10-27T08:23:40Z");

  it("つながっている間は今の時刻を出す", () => {
    expect(getDisplayedSyncTime(true, syncedAt, now)).toBe(now);
  });

  it("切れていれば最後に取り直した時刻を出す", () => {
    expect(getDisplayedSyncTime(false, syncedAt, now)).toBe(syncedAt);
  });
});

describe("startAutoRefresh", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("既定の間隔は60秒", () => {
    expect(IDLE_REFRESH_INTERVAL_MS).toBe(60_000);
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

    vi.advanceTimersByTime(60_000);
    expect(refresh).not.toHaveBeenCalled();

    source.setHidden(false);
    expect(refresh).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60_000);
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
    vi.advanceTimersByTime(59_999);
    expect(refresh).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(refresh).toHaveBeenCalledTimes(2);
  });
});

describe("getRefreshIntervalMs", () => {
  it("AIの番の作業があれば10秒、無ければ60秒", () => {
    expect(getRefreshIntervalMs(true)).toBe(BUSY_REFRESH_INTERVAL_MS);
    expect(getRefreshIntervalMs(true)).toBe(10_000);
    expect(getRefreshIntervalMs(false)).toBe(60_000);
  });
});

describe("getRefreshIntervalMs（即時反映がつながっているとき）", () => {
  it("つながっている間は、AIの番の作業があれば60秒、無ければ5分", () => {
    expect(getRefreshIntervalMs(true, true)).toBe(LIVE_BUSY_REFRESH_INTERVAL_MS);
    expect(getRefreshIntervalMs(true, true)).toBe(60_000);
    expect(getRefreshIntervalMs(false, true)).toBe(LIVE_IDLE_REFRESH_INTERVAL_MS);
    expect(getRefreshIntervalMs(false, true)).toBe(300_000);
  });

  it("切れたら元の10秒・60秒に戻る", () => {
    expect(getRefreshIntervalMs(true, false)).toBe(10_000);
    expect(getRefreshIntervalMs(false, false)).toBe(60_000);
  });

  it("つながっている間は速い更新ではない", () => {
    expect(isFastRefresh(getRefreshIntervalMs(true, true))).toBe(false);
  });
});

class FakeLive implements LiveEventSource {
  closed = false;
  private listeners = new Map<string, Set<() => void>>();
  addEventListener(type: "ready" | "refresh" | "error", listener: () => void) {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener);
    this.listeners.set(type, set);
  }
  close() {
    this.closed = true;
  }
  emit(type: "ready" | "refresh" | "error") {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }
}

describe("startLiveRefresh", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const setup = (hidden = false) => {
    const live = new FakeLive();
    const refresh = vi.fn();
    const onConnectedChange = vi.fn();
    const source = { hidden };
    const stop = startLiveRefresh({ open: () => live, refresh, onConnectedChange, source });
    return { live, refresh, onConnectedChange, source, stop };
  };

  it("ready でつながった、error で切れたと知らせる", () => {
    const { live, onConnectedChange, refresh } = setup();
    live.emit("ready");
    expect(onConnectedChange).toHaveBeenLastCalledWith(true);
    live.emit("error");
    expect(onConnectedChange).toHaveBeenLastCalledWith(false);
    vi.advanceTimersByTime(5_000);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("refresh を受けたら1秒後に取り直す", () => {
    const { live, refresh } = setup();
    live.emit("ready");
    live.emit("refresh");
    vi.advanceTimersByTime(LIVE_REFRESH_DEBOUNCE_MS - 1);
    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("短い間に何通も来ても、取り直しは1回にまとめる", () => {
    const { live, refresh } = setup();
    live.emit("ready");
    for (let i = 0; i < 5; i++) {
      live.emit("refresh");
      vi.advanceTimersByTime(100);
    }
    vi.advanceTimersByTime(LIVE_REFRESH_DEBOUNCE_MS);
    expect(refresh).toHaveBeenCalledTimes(1);

    live.emit("refresh");
    vi.advanceTimersByTime(LIVE_REFRESH_DEBOUNCE_MS);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("つなぎ直したら1回取り直す（最初につながったときは取り直さない）", () => {
    const { live, refresh } = setup();
    live.emit("ready");
    vi.advanceTimersByTime(LIVE_REFRESH_DEBOUNCE_MS);
    expect(refresh).not.toHaveBeenCalled();

    live.emit("error");
    live.emit("ready");
    vi.advanceTimersByTime(LIVE_REFRESH_DEBOUNCE_MS);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("タブが非表示の間は取り直さない", () => {
    const { live, refresh, source } = setup(true);
    live.emit("ready");
    live.emit("refresh");
    vi.advanceTimersByTime(LIVE_REFRESH_DEBOUNCE_MS);
    expect(refresh).not.toHaveBeenCalled();

    source.hidden = false;
    live.emit("refresh");
    source.hidden = true;
    vi.advanceTimersByTime(LIVE_REFRESH_DEBOUNCE_MS);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("止めると接続を閉じ、待っている取り直しもやめる", () => {
    const { live, refresh, stop } = setup();
    live.emit("ready");
    live.emit("refresh");
    stop();
    vi.advanceTimersByTime(LIVE_REFRESH_DEBOUNCE_MS);
    expect(refresh).not.toHaveBeenCalled();
    expect(live.closed).toBe(true);
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
