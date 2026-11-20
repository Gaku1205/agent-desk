import { describe, expect, it } from "vitest";
import {
  budgetOf,
  buildUsageReport,
  cpuDeltaMs,
  dateKeyFromTitle,
  formatUsageBody,
  jstDateKey,
  parseUsageBody,
  recentDateKeys,
  usageRatio,
  usageTitle,
} from "./cpuBudget";

describe("cpuDeltaMs", () => {
  it("user+system の増え分を ms で返す", () => {
    expect(cpuDeltaMs({ user: 1000, system: 500 }, { user: 3000, system: 1500 })).toBe(3);
  });
  it("減っていたら 0", () => {
    expect(cpuDeltaMs({ user: 5000, system: 0 }, { user: 1000, system: 0 })).toBe(0);
  });
});

describe("jstDateKey", () => {
  it("日本時間 0 時の前後で切り替わる", () => {
    expect(jstDateKey(new Date("2026-11-20T14:59:59Z"))).toBe("2026-11-20");
    expect(jstDateKey(new Date("2026-11-20T15:00:00Z"))).toBe("2026-11-21");
  });
  it("直近7日のキーは今日が先頭", () => {
    const keys = recentDateKeys(new Date("2026-11-20T15:00:00Z"));
    expect(keys).toHaveLength(7);
    expect(keys[0]).toBe("2026-11-21");
    expect(keys[6]).toBe("2026-11-15");
  });
});

describe("budgetOf", () => {
  it("境目：0.5 未満は ok、0.5 以上は warn、1.0 以上は over", () => {
    expect(budgetOf(0.4999)).toBe("ok");
    expect(budgetOf(0.5)).toBe("warn");
    expect(budgetOf(0.9999)).toBe("warn");
    expect(budgetOf(1)).toBe("over");
    expect(usageRatio(120000)).toBe(0.5);
    expect(usageRatio(240000)).toBe(1);
  });
});

describe("題名と本文", () => {
  it("題名と本文は読み戻せる", () => {
    expect(usageTitle("2026-11-20")).toBe("使用量：2026-11-20");
    expect(dateKeyFromTitle("使用量：2026-11-20")).toBe("2026-11-20");
    expect(dateKeyFromTitle("表示のずれ：x")).toBeNull();
    expect(parseUsageBody(formatUsageBody(12345))).toBe(12345);
    expect(parseUsageBody("関係ない")).toBeNull();
  });
});

describe("buildUsageReport", () => {
  it("今日の合計・直近7日の1日平均（無い日は 0）・割合", () => {
    const totals = new Map([
      ["2026-11-20", 120000],
      ["2026-11-19", 60000],
      ["2026-11-01", 999999],
    ]);
    const report = buildUsageReport(totals, new Date("2026-11-20T03:00:00Z"));
    expect(report.todayMs).toBe(120000);
    expect(report.avg7Ms).toBe(Math.round(180000 / 7));
    expect(report.ratio).toBe(0.5);
  });
});
