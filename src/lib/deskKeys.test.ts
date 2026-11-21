import { describe, expect, it } from "vitest";
import { deskKeyAction, skipKey, stepKey, type DeskKeyInput } from "./deskKeys";

const base: DeskKeyInput = {
  key: "",
  ctrlKey: false,
  altKey: false,
  metaKey: false,
  shiftKey: false,
  isComposing: false,
  repeat: false,
  typing: false,
  onControl: false,
};

describe("deskKeyAction", () => {
  it("数字・Enter・S・J・K を操作にする", () => {
    expect(deskKeyAction({ ...base, key: "1" })).toEqual({ type: "choose", index: 0 });
    expect(deskKeyAction({ ...base, key: "9" })).toEqual({ type: "choose", index: 8 });
    expect(deskKeyAction({ ...base, key: "Enter" })).toEqual({ type: "answer" });
    expect(deskKeyAction({ ...base, key: "s" })).toEqual({ type: "skip" });
    expect(deskKeyAction({ ...base, key: "j" })).toEqual({ type: "move", delta: 1 });
    expect(deskKeyAction({ ...base, key: "K" })).toEqual({ type: "move", delta: -1 });
    expect(deskKeyAction({ ...base, key: "0" })).toBeNull();
    expect(deskKeyAction({ ...base, key: "x" })).toBeNull();
  });

  it("入力欄に打っている間・修飾キー・変換中・押しっぱなしでは効かない", () => {
    expect(deskKeyAction({ ...base, key: "1", typing: true })).toBeNull();
    expect(deskKeyAction({ ...base, key: "s", typing: true })).toBeNull();
    expect(deskKeyAction({ ...base, key: "Enter", typing: true })).toBeNull();
    expect(deskKeyAction({ ...base, key: "j", ctrlKey: true })).toBeNull();
    expect(deskKeyAction({ ...base, key: "j", metaKey: true })).toBeNull();
    expect(deskKeyAction({ ...base, key: "j", altKey: true })).toBeNull();
    expect(deskKeyAction({ ...base, key: "Enter", isComposing: true })).toBeNull();
    expect(deskKeyAction({ ...base, key: "Enter", repeat: true })).toBeNull();
  });

  it("ボタン・リンクの上の Enter は、その物に任せる", () => {
    expect(deskKeyAction({ ...base, key: "Enter", onControl: true })).toBeNull();
    expect(deskKeyAction({ ...base, key: "1", onControl: true })).toEqual({ type: "choose", index: 0 });
  });
});

describe("stepKey", () => {
  const keys = ["a", "b", "c"];
  it("上下に動き、端では止まる", () => {
    expect(stepKey(keys, "a", 1)).toBe("b");
    expect(stepKey(keys, "c", 1)).toBe("c");
    expect(stepKey(keys, "a", -1)).toBe("a");
    expect(stepKey(keys, null, 1)).toBe("a");
    expect(stepKey([], "a", 1)).toBeNull();
  });
});

describe("skipKey", () => {
  it("次へ移り、最後なら先頭へ回る", () => {
    expect(skipKey(["a", "b", "c"], "a")).toBe("b");
    expect(skipKey(["a", "b", "c"], "c")).toBe("a");
    expect(skipKey(["a"], "a")).toBeNull();
  });
});
