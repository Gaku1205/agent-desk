import { describe, expect, it } from "vitest";
import {
  checkNotifyEvents,
  DEFAULT_NOTIFY_EVENTS,
  formatNotifyEvents,
  NOTIFY_EVENT_KINDS,
  NOTIFY_MESSAGES,
  parseNotifyEvents,
} from "./notifyEvents";

describe("parseNotifyEvents", () => {
  it("無ければ初期値の6つ", () => {
    expect(parseNotifyEvents(null)).toEqual([
      "stuck",
      "question",
      "hold",
      "manual",
      "deployed",
      "deploy_failed",
    ]);
    expect(parseNotifyEvents(null)).toEqual([...DEFAULT_NOTIFY_EVENTS]);
  });

  it("カンマ区切りを読み、決まった並びにする（空白と知らない種類は無視）", () => {
    expect(parseNotifyEvents("ci_failed, stuck ,unknown")).toEqual(["stuck", "ci_failed"]);
  });

  it("空や読めない値は初期値", () => {
    expect(parseNotifyEvents("")).toEqual([...DEFAULT_NOTIFY_EVENTS]);
    expect(parseNotifyEvents("foo")).toEqual([...DEFAULT_NOTIFY_EVENTS]);
  });
});

describe("checkNotifyEvents", () => {
  it("決まった並びにそろえ、重複は1つにする", () => {
    expect(checkNotifyEvents(["merged", "stuck", "stuck"])).toEqual({
      ok: true,
      events: ["stuck", "merged"],
    });
  });

  it("8種類すべてを受け付ける", () => {
    expect(checkNotifyEvents([...NOTIFY_EVENT_KINDS])).toEqual({
      ok: true,
      events: [...NOTIFY_EVENT_KINDS],
    });
  });

  it("知らない種類・文字列でない物・配列でない物は拒否", () => {
    const bad: unknown[] = [["stuck", "nope"], [1], "stuck", null, undefined, { 0: "stuck" }];
    for (const value of bad) {
      expect(checkNotifyEvents(value)).toEqual({ ok: false, message: NOTIFY_MESSAGES.invalid });
    }
  });

  it("0件は拒否", () => {
    expect(checkNotifyEvents([])).toEqual({ ok: false, message: NOTIFY_MESSAGES.empty });
  });
});

describe("formatNotifyEvents", () => {
  it("カンマで区切る", () => {
    expect(formatNotifyEvents(["stuck", "merged"])).toBe("stuck,merged");
  });
});
