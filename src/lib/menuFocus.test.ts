import { describe, expect, it } from "vitest";
import { shouldRestoreMenuFocus } from "./menuFocus";

const closed = { wasOpen: true, menuOpen: false, focusInSheet: false, focusLost: false };

describe("shouldRestoreMenuFocus", () => {
  it("閉じた直後にフォーカスがメニューの中に残っていれば戻す（Esc・項目）", () => {
    expect(shouldRestoreMenuFocus({ ...closed, focusInSheet: true })).toBe(true);
  });

  it("閉じた直後にフォーカスがどこにも無ければ戻す（背景・別のページへ移った）", () => {
    expect(shouldRestoreMenuFocus({ ...closed, focusLost: true })).toBe(true);
  });

  it("閉じたあと別の場所にフォーカスがあるなら動かさない", () => {
    expect(shouldRestoreMenuFocus(closed)).toBe(false);
  });

  it("開いたときと、開いたままのときは戻さない", () => {
    expect(shouldRestoreMenuFocus({ ...closed, wasOpen: false, menuOpen: true, focusLost: true })).toBe(false);
    expect(shouldRestoreMenuFocus({ ...closed, menuOpen: true, focusInSheet: true })).toBe(false);
  });

  it("もともと閉じていたなら戻さない（最初の表示）", () => {
    expect(shouldRestoreMenuFocus({ ...closed, wasOpen: false, focusLost: true })).toBe(false);
  });
});
