import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDLE_CHECK_MS, IDLE_LIMIT_MS, isIdle, startIdleWatch, type ActivitySource } from "./idleWatch";

class FakeSource implements ActivitySource {
  private listeners = new Map<string, Set<() => void>>();
  addEventListener(type: string, listener: () => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)?.add(listener);
  }
  removeEventListener(type: string, listener: () => void) {
    this.listeners.get(type)?.delete(listener);
  }
  fire(type: string) {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }
  get count() {
    return Array.from(this.listeners.values()).reduce((sum, set) => sum + set.size, 0);
  }
}

describe("isIdle", () => {
  it("30分以上操作が無ければ止める。時計が戻ったときは止めない", () => {
    expect(isIdle(0, IDLE_LIMIT_MS - 1)).toBe(false);
    expect(isIdle(0, IDLE_LIMIT_MS)).toBe(true);
    expect(isIdle(10_000, 0)).toBe(false);
  });
});

describe("startIdleWatch", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("30分操作が無いと1回だけ知らせ、見るのをやめる", async () => {
    const source = new FakeSource();
    const onIdle = vi.fn();
    startIdleWatch({ source, onIdle });
    await vi.advanceTimersByTimeAsync(IDLE_LIMIT_MS + IDLE_CHECK_MS);
    expect(onIdle).toHaveBeenCalledTimes(1);
    expect(source.count).toBe(0);
    await vi.advanceTimersByTimeAsync(IDLE_LIMIT_MS);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it("操作があれば数え直す", async () => {
    const source = new FakeSource();
    const onIdle = vi.fn();
    const stop = startIdleWatch({ source, onIdle });
    await vi.advanceTimersByTimeAsync(IDLE_LIMIT_MS - 60_000);
    source.fire("keydown");
    await vi.advanceTimersByTimeAsync(IDLE_LIMIT_MS - 60_000);
    expect(onIdle).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(onIdle).toHaveBeenCalledTimes(1);
    stop();
  });
});
