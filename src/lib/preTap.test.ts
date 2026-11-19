import { describe, expect, it } from "vitest";
import { isPreTapExpired, PRE_TAP_WINDOW_MS, shouldReplayPreTap } from "./preTap";

const base = { tappedAt: 1000, now: 2000, marked: true, replayed: false, connected: true, hydrated: true };

describe("shouldReplayPreTap", () => {
  it("印があり、時間内で、React が動いたら流し直す", () => {
    expect(shouldReplayPreTap(base)).toBe(true);
  });
  it("上限ちょうどまでは流し直す", () => {
    expect(shouldReplayPreTap({ ...base, now: 1000 + PRE_TAP_WINDOW_MS })).toBe(true);
  });
  it("5秒を過ぎたら流し直さない", () => {
    expect(shouldReplayPreTap({ ...base, now: 1000 + PRE_TAP_WINDOW_MS + 1 })).toBe(false);
  });
  it("印が無ければ流し直さない", () => {
    expect(shouldReplayPreTap({ ...base, marked: false })).toBe(false);
  });
  it("すでに流し直したら流し直さない", () => {
    expect(shouldReplayPreTap({ ...base, replayed: true })).toBe(false);
  });
  it("React がまだなら流し直さない", () => {
    expect(shouldReplayPreTap({ ...base, hydrated: false })).toBe(false);
  });
  it("要素が消えていたら流し直さない", () => {
    expect(shouldReplayPreTap({ ...base, connected: false })).toBe(false);
  });
});

describe("isPreTapExpired", () => {
  it("時間内で印があれば、まだ待つ", () => {
    expect(isPreTapExpired(base)).toBe(false);
  });
  it("時間切れ・消えた・流し直した・印なしは待たない", () => {
    expect(isPreTapExpired({ ...base, now: 1000 + PRE_TAP_WINDOW_MS + 1 })).toBe(true);
    expect(isPreTapExpired({ ...base, connected: false })).toBe(true);
    expect(isPreTapExpired({ ...base, replayed: true })).toBe(true);
    expect(isPreTapExpired({ ...base, marked: false })).toBe(true);
  });
});
