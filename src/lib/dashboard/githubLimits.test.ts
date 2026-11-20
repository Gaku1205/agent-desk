import { describe, expect, it } from "vitest";
import {
  chartTop,
  exceededSlots,
  formatResetAt,
  hourLabel,
  hourlyUsed,
  hourStarts,
  limitsSummary,
  peakValue,
  remainingRatio,
  showLimitLine,
  sumSeries,
  type RateSample,
} from "./githubLimits";

describe("線グラフの縦の目盛り（Issue #720）", () => {
  it("いちばん大きい値を取る（null は数えない）", () => {
    expect(peakValue([180, null, 331], [null, 250])).toBe(331);
    expect(peakValue([null], [])).toBe(0);
  });
  it("上限が最大値の2倍以内なら上限の線を出す（近い）", () => {
    expect(showLimitLine(3000)).toBe(true);
    expect(showLimitLine(2500)).toBe(true);
  });
  it("上限が最大値の2倍より遠いなら線は出さない（凡例だけ）", () => {
    expect(showLimitLine(331)).toBe(false);
    expect(showLimitLine(2499)).toBe(false);
    expect(showLimitLine(0)).toBe(false);
  });
  it("遠いときは最大値の少し上（1.1倍）まで。近いときは上限も入る", () => {
    expect(chartTop(331)).toBeCloseTo(364.1);
    expect(chartTop(3000)).toBeCloseTo(5500);
    expect(chartTop(0)).toBe(1);
  });
});

const HOUR = 3_600_000;
// 2026-11-18 02:30 UTC = 11:30 JST
const NOW = Date.UTC(2026, 10, 18, 2, 30);
const RESET = Math.floor(NOW / 1000) + 1800;

function sample(minutesAgo: number, remaining: number, resetAt: number | null = RESET): RateSample {
  return { at: NOW - minutesAgo * 60_000, remaining, resetAt };
}

describe("hourStarts", () => {
  it("24個、古い順で、いちばん新しい枠は今を含む時間", () => {
    const starts = hourStarts(NOW);
    expect(starts).toHaveLength(24);
    expect(starts[23]).toBe(Date.UTC(2026, 10, 18, 2));
    expect(starts[0]).toBe(Date.UTC(2026, 10, 17, 3));
  });
});

describe("hourlyUsed", () => {
  it("点が無ければ全部 null", () => {
    expect(hourlyUsed([], NOW).every((v) => v === null)).toBe(true);
  });

  it("同じ回復の周期の中で減った分を、あとの点の時間帯に足す", () => {
    const used = hourlyUsed([sample(20, 4000), sample(10, 3900), sample(0, 3700)], NOW);
    expect(used[23]).toBe(300);
    expect(used[22]).toBeNull();
  });

  it("点が1つだけの時間帯は null", () => {
    expect(hourlyUsed([sample(0, 4000)], NOW)[23]).toBeNull();
  });

  it("回復をまたぐ所（回復の時刻が違う）は数えない", () => {
    const used = hourlyUsed([sample(20, 100, RESET - 3600), sample(10, 4900, RESET)], NOW);
    expect(used[23]).toBeNull();
  });

  it("回復の時刻が不明な点は数えない", () => {
    expect(hourlyUsed([sample(20, 100, null), sample(10, 50, null)], NOW)[23]).toBeNull();
  });

  it("1時間より離れた点の間は数えない", () => {
    expect(hourlyUsed([sample(100, 4000), sample(0, 3000)], NOW)[23]).toBeNull();
  });

  it("残りが増えた所は数えない", () => {
    expect(hourlyUsed([sample(10, 3000), sample(0, 3500)], NOW)[23]).toBeNull();
  });

  it("枠をまたぐ組は、あとの点の枠に入る", () => {
    // 02:10 の点と 01:55 の点
    const used = hourlyUsed([sample(35, 4000), sample(20, 3800)], NOW);
    expect(used[23]).toBe(200);
  });

  it("24時間より前の点は無視する", () => {
    const old: RateSample[] = [
      { at: NOW - 30 * HOUR, remaining: 4000, resetAt: RESET },
      { at: NOW - 30 * HOUR + 60_000, remaining: 3000, resetAt: RESET },
    ];
    expect(hourlyUsed(old, NOW).every((v) => v === null)).toBe(true);
  });
});

describe("sumSeries", () => {
  it("null でない物だけ足し、全部 null の時間帯だけ null", () => {
    expect(sumSeries([[1, null, null], [2, 3, null]], 3)).toEqual([3, 3, null]);
  });
});

describe("exceededSlots", () => {
  it("上限を超えた時間帯の番号。ちょうどは超えていない", () => {
    expect(exceededSlots([5000, 5001, null, 100])).toEqual([1]);
  });
});

describe("formatResetAt / hourLabel", () => {
  it("日本時間の時刻", () => {
    expect(formatResetAt(Math.floor(NOW / 1000))).toBe("11:30");
    expect(formatResetAt(null)).toBeNull();
    expect(hourLabel(Date.UTC(2026, 10, 18, 2))).toBe("11");
  });
});

describe("remainingRatio", () => {
  it("残り÷上限（0〜1）。不明は null", () => {
    expect(remainingRatio(3912)).toBeCloseTo(0.7824);
    expect(remainingRatio(9000)).toBe(1);
    expect(remainingRatio(null)).toBeNull();
  });
});

describe("limitsSummary", () => {
  const starts = hourStarts(NOW);
  const none = Array<number | null>(24).fill(null);

  it("履歴が無ければその旨", () => {
    expect(limitsSummary(starts, none, none)).toContain("履歴はまだありません");
  });

  it("超えた時間帯が無ければそう書く", () => {
    const series = Array<number | null>(24).fill(300);
    expect(limitsSummary(starts, series, none)).toBe("上限 5,000 超えの時間帯：なし");
  });

  it("超えた時間帯を書く", () => {
    const series = Array<number | null>(24).fill(300);
    series[23] = 5200;
    series[22] = 5100;
    expect(limitsSummary(starts, series, none)).toBe(
      "上限 5,000 超えの時間帯：Pipeline 10時台・11時台",
    );
  });
});
