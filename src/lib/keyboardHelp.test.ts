import { describe, expect, it } from "vitest";
import { isHelpToggleKey, isTypingTarget, type HelpKeyInput } from "./keyboardHelp";

const base: HelpKeyInput = {
  key: "?",
  ctrlKey: false,
  altKey: false,
  metaKey: false,
  isComposing: false,
  repeat: false,
  target: { tagName: "BODY", isContentEditable: false },
};

describe("isHelpToggleKey", () => {
  it("? だけで反応する", () => {
    expect(isHelpToggleKey(base)).toBe(true);
    expect(isHelpToggleKey({ ...base, key: "/" })).toBe(false);
    expect(isHelpToggleKey({ ...base, key: "h" })).toBe(false);
  });

  it("フォーカス先が無くても反応する", () => {
    expect(isHelpToggleKey({ ...base, target: null })).toBe(true);
  });

  it("ボタンやリンクにフォーカスがあっても反応する", () => {
    expect(isHelpToggleKey({ ...base, target: { tagName: "BUTTON", isContentEditable: false } })).toBe(true);
    expect(isHelpToggleKey({ ...base, target: { tagName: "A", isContentEditable: false } })).toBe(true);
  });

  it("入力欄・編集できる要素では反応しない", () => {
    for (const tagName of ["INPUT", "TEXTAREA", "SELECT", "input"]) {
      expect(isHelpToggleKey({ ...base, target: { tagName, isContentEditable: false } })).toBe(false);
    }
    expect(isHelpToggleKey({ ...base, target: { tagName: "DIV", isContentEditable: true } })).toBe(false);
  });

  it("Ctrl・Alt・Meta を押しているときは反応しない", () => {
    expect(isHelpToggleKey({ ...base, ctrlKey: true })).toBe(false);
    expect(isHelpToggleKey({ ...base, altKey: true })).toBe(false);
    expect(isHelpToggleKey({ ...base, metaKey: true })).toBe(false);
  });

  it("変換中・押しっぱなしの繰り返しでは反応しない", () => {
    expect(isHelpToggleKey({ ...base, isComposing: true })).toBe(false);
    expect(isHelpToggleKey({ ...base, repeat: true })).toBe(false);
  });
});

describe("isTypingTarget", () => {
  it("null は入力欄ではない", () => {
    expect(isTypingTarget(null)).toBe(false);
  });
});
