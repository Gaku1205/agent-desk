import { beforeEach, describe, expect, it } from "vitest";
import type { UsageIssues } from "../github/usageIssue";
import { clearUsageStateForTest, recordCpuUsage, type UsageStore } from "./record";

function makeStore(issues: UsageIssues | null, writable = true) {
  const writes: string[] = [];
  const store: UsageStore = {
    list: async () => issues,
    create: async (title, body) => {
      writes.push(`create ${title} ${body.split("\n")[0]}`);
      return writable;
    },
    update: async (number, body) => {
      writes.push(`update ${number} ${body.split("\n")[0]}`);
      return writable;
    },
  };
  return { store, writes };
}

const NOW = new Date("2026-11-20T03:00:00Z");

beforeEach(() => clearUsageStateForTest());

describe("recordCpuUsage", () => {
  it("1回目は起動からの全部を、その日の Issue の今の合計に足す", async () => {
    const { store, writes } = makeStore(new Map([["2026-11-20", { number: 7, totalMs: 100000 }]]));
    const out = await recordCpuUsage(store, NOW, { user: 20_000_000, system: 0 });
    expect(writes).toEqual(["update 7 CPU時間（ms）：120000"]);
    expect(out.usage?.todayMs).toBe(120000);
    expect(out.budget).toBe("warn");
  });

  it("Issue が無い日は立てる", async () => {
    const { store, writes } = makeStore(new Map());
    const out = await recordCpuUsage(store, NOW, { user: 1_000_000, system: 0 });
    expect(writes).toEqual(["create 使用量：2026-11-20 CPU時間（ms）：1000"]);
    expect(out.budget).toBe("ok");
  });

  it("10分未満の続けての呼び出しは書かず、増え分は次に持ち越す", async () => {
    const { store, writes } = makeStore(new Map());
    await recordCpuUsage(store, NOW, { user: 1_000_000, system: 0 });
    await recordCpuUsage(store, new Date(NOW.getTime() + 5 * 60_000), { user: 3_000_000, system: 0 });
    expect(writes).toHaveLength(1);
    const { store: next, writes: nextWrites } = makeStore(new Map([["2026-11-20", { number: 1, totalMs: 1000 }]]));
    await recordCpuUsage(next, new Date(NOW.getTime() + 10 * 60_000), { user: 3_000_000, system: 0 });
    expect(nextWrites).toEqual(["update 1 CPU時間（ms）：3000"]);
  });

  it("読めない・書けないときは usage: null・budget: unknown", async () => {
    expect(await recordCpuUsage(makeStore(null).store, NOW, { user: 1_000_000, system: 0 })).toEqual({
      usage: null,
      budget: "unknown",
    });
    expect(await recordCpuUsage(makeStore(new Map(), false).store, NOW, { user: 1_000_000, system: 0 })).toEqual({
      usage: null,
      budget: "unknown",
    });
  });
});
