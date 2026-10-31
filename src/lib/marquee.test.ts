import { describe, expect, it } from "vitest";
import { MARQUEE_EDGE, marqueeCycle, marqueeDistance, marqueeDuration } from "./marquee";

describe("marqueeDistance", () => {
  it("入っている行・まだ測れていない行は流さない", () => {
    expect(marqueeDistance(100, 200)).toBe(0);
    expect(marqueeDistance(200, 200)).toBe(0);
    expect(marqueeDistance(0, 0)).toBe(0);
    expect(marqueeDistance(300, 0)).toBe(0);
    expect(marqueeDistance(Number.NaN, 100)).toBe(0);
  });

  it("1px未満の差（小数と丸めの差）は入っているとみなす", () => {
    expect(marqueeDistance(80.48, 80)).toBe(0);
    expect(marqueeDistance(300.99, 300)).toBe(0);
  });

  it("切れている行は、末尾が右端の消す幅の手前に来るまで流す", () => {
    expect(marqueeDistance(500, 300)).toBe(200 + MARQUEE_EDGE);
    expect(marqueeDistance(301, 300)).toBe(1 + MARQUEE_EDGE);
    expect(marqueeDistance(301.5, 300)).toBe(2 + MARQUEE_EDGE);
  });
});

describe("marqueeDuration", () => {
  it("乗せたとき：0.8秒待ち、40px/秒で流れ、1.2秒止まり、0.3秒で戻る", () => {
    expect(marqueeDuration(200, "hover")).toBe(800 + 5000 + 1200 + 300);
  });

  it("スマホ：先頭と末尾で2秒ずつ止まり、ゆっくり流れる", () => {
    expect(marqueeDuration(240, "view")).toBe(2000 + 10000 + 2000 + 300);
  });

  it("流さない行は0", () => {
    expect(marqueeDuration(0, "hover")).toBe(0);
  });
});

describe("marqueeCycle", () => {
  it("流さない行は空", () => {
    expect(marqueeCycle(0, "hover")).toEqual({ duration: 0, frames: [] });
  });

  it("先頭で待ち、末尾まで流れ、止まり、フェードして先頭へ戻る", () => {
    const { duration, frames } = marqueeCycle(200, "hover");
    expect(duration).toBe(7300);
    expect(frames[0]).toEqual({ offset: 0, shift: 0, opacity: 1 });
    expect(frames[1].offset).toBeCloseTo(800 / 7300);
    expect(frames[1].shift).toBe(0);
    expect(frames[2].offset).toBeCloseTo(5800 / 7300);
    expect(frames[2].shift).toBe(200);
    expect(frames[3].offset).toBeCloseTo(7000 / 7300);
    expect(frames[4]).toMatchObject({ shift: 200, opacity: 0 });
    expect(frames[5]).toMatchObject({ shift: 0, opacity: 0 });
    expect(frames[4].offset).toBe(frames[5].offset);
    expect(frames[6]).toEqual({ offset: 1, shift: 0, opacity: 1 });
  });

  it("offset は昇順に並ぶ", () => {
    const offsets = marqueeCycle(333, "view").frames.map((f) => f.offset);
    expect(offsets).toEqual([...offsets].sort((a, b) => a - b));
  });
});
