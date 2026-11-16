import { describe, expect, it } from "vitest";
import {
  SIDEBAR_INIT_SCRIPT,
  SIDEBAR_STORAGE_KEY,
  applySidebar,
  parseSidebarCollapsed,
  readSidebarCollapsed,
  sidebarAttribute,
  writeSidebarCollapsed,
} from "./sidebar";

describe("parseSidebarCollapsed", () => {
  it("closed だけが畳んだ状態", () => {
    expect(parseSidebarCollapsed("closed")).toBe(true);
    expect(parseSidebarCollapsed("open")).toBe(false);
    expect(parseSidebarCollapsed(null)).toBe(false);
    expect(parseSidebarCollapsed("xyz")).toBe(false);
  });
});

describe("readSidebarCollapsed", () => {
  it("保存された値を読む", () => {
    expect(readSidebarCollapsed({ getItem: () => "closed" })).toBe(true);
    expect(readSidebarCollapsed({ getItem: () => "open" })).toBe(false);
  });
  it("使えない・例外のときは開いた状態", () => {
    expect(readSidebarCollapsed(null)).toBe(false);
    expect(readSidebarCollapsed(undefined)).toBe(false);
    expect(
      readSidebarCollapsed({
        getItem: () => {
          throw new Error("denied");
        },
      }),
    ).toBe(false);
  });
});

describe("writeSidebarCollapsed", () => {
  it("保存して true を返す", () => {
    const saved: Record<string, string> = {};
    const storage = { setItem: (k: string, v: string) => void (saved[k] = v) };
    expect(writeSidebarCollapsed(storage, true)).toBe(true);
    expect(saved[SIDEBAR_STORAGE_KEY]).toBe("closed");
    expect(writeSidebarCollapsed(storage, false)).toBe(true);
    expect(saved[SIDEBAR_STORAGE_KEY]).toBe("open");
  });
  it("保存できないときは false", () => {
    expect(writeSidebarCollapsed(null, true)).toBe(false);
    expect(
      writeSidebarCollapsed(
        {
          setItem: () => {
            throw new Error("full");
          },
        },
        true,
      ),
    ).toBe(false);
  });
});

describe("sidebarAttribute / applySidebar", () => {
  it("畳んだときだけ印を付ける", () => {
    expect(sidebarAttribute(true)).toBe("closed");
    expect(sidebarAttribute(false)).toBeNull();
    const attrs = new Map<string, string>();
    const root = {
      setAttribute: (k: string, v: string) => void attrs.set(k, v),
      removeAttribute: (k: string) => void attrs.delete(k),
    } as unknown as HTMLElement;
    applySidebar(true, root);
    expect(attrs.get("data-side")).toBe("closed");
    applySidebar(false, root);
    expect(attrs.has("data-side")).toBe(false);
  });
});

describe("SIDEBAR_INIT_SCRIPT", () => {
  const run = (value: string | null, throws = false) => {
    const attrs = new Map<string, string>();
    const storage = {
      getItem: () => {
        if (throws) throw new Error("denied");
        return value;
      },
    };
    const doc = { documentElement: { setAttribute: (k: string, v: string) => void attrs.set(k, v) } };
    new Function("localStorage", "document", SIDEBAR_INIT_SCRIPT)(storage, doc);
    return attrs;
  };
  it("畳んでいたときだけ data-side を付ける", () => {
    expect(run("closed").get("data-side")).toBe("closed");
    expect(run("open").size).toBe(0);
    expect(run(null).size).toBe(0);
  });
  it("読めなくても落ちない", () => {
    expect(run(null, true).size).toBe(0);
  });
});
