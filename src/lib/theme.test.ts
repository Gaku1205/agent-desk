import { describe, expect, it } from "vitest";
import {
  THEME_INIT_SCRIPT,
  THEME_STORAGE_KEY,
  parseTheme,
  readTheme,
  resolveTheme,
  themeAttribute,
  writeTheme,
} from "./theme";

describe("parseTheme", () => {
  it("白・黒はそのまま、それ以外は OS に合わせる", () => {
    expect(parseTheme("light")).toBe("light");
    expect(parseTheme("dark")).toBe("dark");
    expect(parseTheme("system")).toBe("system");
    expect(parseTheme("blue")).toBe("system");
    expect(parseTheme(null)).toBe("system");
    expect(parseTheme(undefined)).toBe("system");
  });
});

describe("resolveTheme", () => {
  it("OS に合わせるときは OS の設定どおり", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });

  it("白・黒を選んでいれば OS の設定にかかわらずそれを使う", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });
});

describe("themeAttribute", () => {
  it("OS に合わせるときは付けない", () => {
    expect(themeAttribute("system")).toBeNull();
    expect(themeAttribute("light")).toBe("light");
    expect(themeAttribute("dark")).toBe("dark");
  });
});

describe("readTheme / writeTheme", () => {
  it("書いた値を読める", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    };
    expect(readTheme(storage)).toBe("system");
    expect(writeTheme(storage, "dark")).toBe(true);
    expect(store.get(THEME_STORAGE_KEY)).toBe("dark");
    expect(readTheme(storage)).toBe("dark");
  });

  it("使えない・例外のときは OS に合わせる／false", () => {
    const broken = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    expect(readTheme(broken)).toBe("system");
    expect(readTheme(null)).toBe("system");
    expect(writeTheme(broken, "light")).toBe(false);
    expect(writeTheme(null, "light")).toBe(false);
  });
});

describe("THEME_INIT_SCRIPT", () => {
  it("保存のキーと data-theme を含む", () => {
    expect(THEME_INIT_SCRIPT).toContain(THEME_STORAGE_KEY);
    expect(THEME_INIT_SCRIPT).toContain("data-theme");
  });
});
