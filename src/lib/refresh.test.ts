import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  formatSyncTime,
  isRefreshKey,
  REFRESH_INTERVAL_MS,
  startAutoRefresh,
  type RefreshKeyEvent,
  type VisibilitySource,
} from "./refresh";

function keyEvent(overrides: Partial<RefreshKeyEvent> = {}): RefreshKeyEvent {
  return {
    key: "r",
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    repeat: false,
    isComposing: false,
    targetTag: "BODY",
    targetEditable: false,
    ...overrides,
  };
}

describe("isRefreshKey", () => {
  it("r と R で反応する", () => {
    expect(isRefreshKey(keyEvent({ key: "r" }))).toBe(true);
    expect(isRefreshKey(keyEvent({ key: "R" }))).toBe(true);
  });

  it("他のキーには反応しない", () => {
    expect(isRefreshKey(keyEvent({ key: "e" }))).toBe(false);
    expect(isRefreshKey(keyEvent({ key: "Enter" }))).toBe(false);
  });

  it("入力欄・選択欄・編集できる要素では反応しない", () => {
    expect(isRefreshKey(keyEvent({ targetTag: "INPUT" }))).toBe(false);
    expect(isRefreshKey(keyEvent({ targetTag: "TEXTAREA" }))).toBe(false);
    expect(isRefreshKey(keyEvent({ targetTag: "SELECT" }))).toBe(false);
    expect(isRefreshKey(keyEvent({ targetTag: "DIV", targetEditable: true }))).toBe(false);
  });

  it("ボタンやリンクにフォーカスがあっても反応する", () => {
    expect(isRefreshKey(keyEvent({ targetTag: "BUTTON" }))).toBe(true);
    expect(isRefreshKey(keyEvent({ targetTag: "A" }))).toBe(true);
  });

  it("Ctrl・Cmd・Alt との組み合わせ（再読み込みなど）には反応しない", () => {
    expect(isRefreshKey(keyEvent({ ctrlKey: true }))).toBe(false);
    expect(isRefreshKey(keyEvent({ metaKey: true }))).toBe(false);
    expect(isRefreshKey(keyEvent({ altKey: true }))).toBe(false);
  });

  it("押しっぱなしの繰り返しと、変換中には反応しない", () => {
    expect(isRefreshKey(keyEvent({ repeat: true }))).toBe(false);
    expect(isRefreshKey(keyEvent({ isComposing: true }))).toBe(false);
  });
});

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

describe("startAutoRefresh", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("間隔は30秒", () => {
    expect(REFRESH_INTERVAL_MS).toBe(30_000);
  });

  it("30秒ごとに取り直す", () => {
    const refresh = vi.fn();
    startAutoRefresh({ refresh, source: new FakeDocument() });

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
    vi.advanceTimersByTime(30_000);
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
});
