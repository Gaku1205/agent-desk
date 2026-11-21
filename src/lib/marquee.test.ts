import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createLongPress,
  isOverflowing,
  LONG_PRESS_MS,
  marqueeDistance,
  marqueeTiming,
} from "./marquee";

describe("isOverflowing", () => {
  it("箱より中身が大きければ切れている", () => {
    expect(isOverflowing(300, 200)).toBe(true);
  });
  it("同じ大きさ・小数点の誤差は切れていない", () => {
    expect(isOverflowing(200, 200)).toBe(false);
    expect(isOverflowing(200.6, 200)).toBe(false);
  });
});

describe("marqueeDistance", () => {
  it("題名の最後が見える所までの長さ", () => {
    expect(marqueeDistance(500, 200)).toBe(300);
    expect(marqueeDistance(500.2, 200)).toBe(301);
  });
  it("はみ出していなければ 0", () => {
    expect(marqueeDistance(100, 200)).toBe(0);
  });
});

describe("marqueeTiming", () => {
  it("60px/秒で、前後に1秒ずつ止まる", () => {
    const t = marqueeTiming(300);
    expect(t).not.toBeNull();
    // 流れる 5 秒 + 止まる 2 秒
    expect(t?.durationMs).toBe(7000);
    expect(t?.startOffset).toBeCloseTo(1000 / 7000);
    expect(t?.endOffset).toBeCloseTo(6000 / 7000);
  });
  it("長さに比例して延びる", () => {
    const short = marqueeTiming(120);
    const long = marqueeTiming(240);
    expect((long?.durationMs ?? 0) - 2000).toBeCloseTo(((short?.durationMs ?? 0) - 2000) * 2);
  });
  it("流す長さが無ければ流さない", () => {
    expect(marqueeTiming(0)).toBeNull();
    expect(marqueeTiming(-5)).toBeNull();
  });
});

describe("createLongPress", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("長押ししたあと離すと、直後の「押した」は無かったことになる", () => {
    const onLong = vi.fn();
    const press = createLongPress({ onLong });
    press.start();
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(onLong).toHaveBeenCalledTimes(1);
    expect(press.end()).toBe(true);
    expect(press.consumeClick()).toBe(true);
    // 1回だけ
    expect(press.consumeClick()).toBe(false);
  });

  it("短く触れたときは長押しにならず、「押した」は通る", () => {
    const onLong = vi.fn();
    const press = createLongPress({ onLong });
    press.start();
    vi.advanceTimersByTime(LONG_PRESS_MS - 100);
    expect(press.end()).toBe(false);
    vi.advanceTimersByTime(1000);
    expect(onLong).not.toHaveBeenCalled();
    expect(press.consumeClick()).toBe(false);
  });

  it("途中でやめたら長押しにならない", () => {
    const onLong = vi.fn();
    const press = createLongPress({ onLong });
    press.start();
    press.cancel();
    vi.advanceTimersByTime(LONG_PRESS_MS * 2);
    expect(onLong).not.toHaveBeenCalled();
    expect(press.end()).toBe(false);
  });

  it("時間がたってから来た「押した」は無かったことにしない", () => {
    const press = createLongPress({ onLong: () => {} });
    press.start();
    vi.advanceTimersByTime(LONG_PRESS_MS);
    press.end();
    vi.advanceTimersByTime(5000);
    expect(press.consumeClick()).toBe(false);
  });
});
