import { describe, expect, it } from "vitest";
import { toggleQueueReasonOpen } from "./queueReasonOpen";

describe("toggleQueueReasonOpen", () => {
  it("閉じている行を開く", () => {
    expect([...toggleQueueReasonOpen(new Set(), 3)]).toEqual([3]);
  });

  it("開いている行を閉じる", () => {
    expect([...toggleQueueReasonOpen(new Set([3]), 3)]).toEqual([]);
  });

  it("ほかの行の開閉に影響しない", () => {
    expect([...toggleQueueReasonOpen(new Set([1, 5]), 3)].sort()).toEqual([1, 3, 5]);
    expect([...toggleQueueReasonOpen(new Set([1, 3, 5]), 3)].sort()).toEqual([1, 5]);
  });

  it("渡された集合は変えない", () => {
    const open = new Set([1]);
    toggleQueueReasonOpen(open, 2);
    expect([...open]).toEqual([1]);
  });
});
