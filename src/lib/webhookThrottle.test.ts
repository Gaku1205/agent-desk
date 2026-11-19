import { describe, expect, it } from "vitest";
import {
  invalidationPeriod,
  msUntilNextInvalidationPeriod,
  planInvalidation,
  WEBHOOK_INVALIDATE_PERIOD_MS,
  type ClaimSlot,
} from "./webhookThrottle";

function memoryClaim(): ClaimSlot {
  const taken = new Set<string>();
  return async (kind, period) => {
    const key = `${kind}:${period}`;
    if (taken.has(key)) return false;
    taken.add(key);
    return true;
  };
}

describe("planInvalidation", () => {
  it("急ぎでない知らせが30秒に何回来ても、すぐ無効にするのは1回、まとめる予約も1回", async () => {
    const claim = memoryClaim();
    const base = 10 * WEBHOOK_INVALIDATE_PERIOD_MS;
    const plans: string[] = [];
    for (let i = 0; i < 20; i += 1) {
      plans.push(await planInvalidation({ urgent: false, now: base + i * 1_000, claim }));
    }
    expect(plans.filter((plan) => plan === "now")).toHaveLength(1);
    expect(plans.filter((plan) => plan === "defer")).toHaveLength(1);
    expect(plans.filter((plan) => plan === "skip")).toHaveLength(18);
  });

  it("次の区切りでは、また1回すぐ無効にする", async () => {
    const claim = memoryClaim();
    const base = 10 * WEBHOOK_INVALIDATE_PERIOD_MS;
    expect(await planInvalidation({ urgent: false, now: base, claim })).toBe("now");
    expect(await planInvalidation({ urgent: false, now: base + 31_000, claim })).toBe("now");
  });

  it("急ぎの知らせは、区切りの中でも毎回すぐ無効にする", async () => {
    const claim = memoryClaim();
    const base = 10 * WEBHOOK_INVALIDATE_PERIOD_MS;
    expect(await planInvalidation({ urgent: false, now: base, claim })).toBe("now");
    expect(await planInvalidation({ urgent: true, now: base + 1_000, claim })).toBe("now");
    expect(await planInvalidation({ urgent: true, now: base + 2_000, claim })).toBe("now");
  });

  it("急ぎの知らせの後の急ぎでない知らせは、すぐは無効にしない（まとめる）", async () => {
    const claim = memoryClaim();
    const base = 10 * WEBHOOK_INVALIDATE_PERIOD_MS;
    expect(await planInvalidation({ urgent: true, now: base, claim })).toBe("now");
    expect(await planInvalidation({ urgent: false, now: base + 1_000, claim })).toBe("defer");
  });
});

describe("区切り", () => {
  it("30秒ごとに番号が進み、次の区切りまでの時間が分かる", () => {
    expect(invalidationPeriod(29_999)).toBe(0);
    expect(invalidationPeriod(30_000)).toBe(1);
    expect(msUntilNextInvalidationPeriod(10_000)).toBe(20_000);
    expect(msUntilNextInvalidationPeriod(30_000)).toBe(30_000);
  });
});
