import { describe, expect, it } from "vitest";
import { requestedAtAfterSync, SYNC_WAIT_LIMIT_MS, syncAfterPlan } from "./syncWait";

const last = new Date("2026-11-19T07:00:00Z");
const pressed = new Date("2026-11-19T07:05:00Z");

describe("requestedAtAfterSync（同期の時刻の決め方）", () => {
  it("届いたなら押した時刻", () => {
    expect(requestedAtAfterSync({ requestedAt: pressed, lastSyncedAt: last, reached: true })).toBe(pressed);
  });

  it("届かなかったなら、最後に取り直せた時刻のまま（進めない）", () => {
    expect(requestedAtAfterSync({ requestedAt: pressed, lastSyncedAt: last, reached: false })).toBe(last);
  });

  it("待つ上限は30秒", () => {
    expect(SYNC_WAIT_LIMIT_MS).toBe(30_000);
  });
});

describe("syncAfterPlan（取り直しの結果が届いたときの同期の時刻）", () => {
  it("1つでも読めたら、取り直しを始めた時刻にし、最後に読めた時刻も進める", () => {
    expect(syncAfterPlan({ readFailed: false, requestedAt: pressed, lastReadAt: last })).toEqual({
      shownAt: pressed,
      lastReadAt: pressed,
    });
  });

  it("全部読めなかったら、時刻を進めず最後に読めた時刻のまま", () => {
    const next = syncAfterPlan({ readFailed: true, requestedAt: pressed, lastReadAt: last });
    expect(next.shownAt).toBe(last);
    expect(next.lastReadAt).toBe(last);
  });
});
