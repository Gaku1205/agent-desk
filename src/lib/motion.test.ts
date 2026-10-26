import { describe, expect, it } from "vitest";
import {
  MOTION_INIT_SCRIPT,
  MOTION_STORAGE_KEY,
  motionAttribute,
  parseMotion,
  readMotion,
  writeMotion,
} from "./motion";

describe("parseMotion", () => {
  it("on / off はそのまま", () => {
    expect(parseMotion("on")).toBe("on");
    expect(parseMotion("off")).toBe("off");
  });

  it.each([null, undefined, "", "system", "ON", "true", 1, {}])(
    "不正な値（%s）は従う",
    (raw) => {
      expect(parseMotion(raw)).toBe("system");
    },
  );
});

describe("motionAttribute", () => {
  it("オンは full、オフは reduce、従うは付けない", () => {
    expect(motionAttribute("on")).toBe("full");
    expect(motionAttribute("off")).toBe("reduce");
    expect(motionAttribute("system")).toBeNull();
  });
});

describe("readMotion", () => {
  it("保存された値を読む", () => {
    expect(readMotion({ getItem: () => "off" })).toBe("off");
  });

  it("キーを指定して読む", () => {
    let key = "";
    readMotion({
      getItem: (k) => {
        key = k;
        return null;
      },
    });
    expect(key).toBe(MOTION_STORAGE_KEY);
  });

  it("ストレージが無い・例外のときは従う", () => {
    expect(readMotion(null)).toBe("system");
    expect(
      readMotion({
        getItem: () => {
          throw new Error("denied");
        },
      }),
    ).toBe("system");
  });
});

describe("writeMotion", () => {
  it("書けたら true", () => {
    const saved: Record<string, string> = {};
    const ok = writeMotion(
      { setItem: (k, v) => void (saved[k] = v) },
      "on",
    );
    expect(ok).toBe(true);
    expect(saved[MOTION_STORAGE_KEY]).toBe("on");
  });

  it("使えない・例外のときは false", () => {
    expect(writeMotion(null, "on")).toBe(false);
    expect(
      writeMotion(
        {
          setItem: () => {
            throw new Error("quota");
          },
        },
        "off",
      ),
    ).toBe(false);
  });
});

describe("MOTION_INIT_SCRIPT", () => {
  function run(value: string | null | "throw") {
    const attrs: Record<string, string> = {};
    const fakeDocument = {
      documentElement: { setAttribute: (k: string, v: string) => void (attrs[k] = v) },
    };
    const fakeStorage = {
      getItem: () => {
        if (value === "throw") throw new Error("denied");
        return value;
      },
    };
    new Function("localStorage", "document", MOTION_INIT_SCRIPT)(fakeStorage, fakeDocument);
    return attrs;
  }

  it("on → full、off → reduce", () => {
    expect(run("on")).toEqual({ "data-motion": "full" });
    expect(run("off")).toEqual({ "data-motion": "reduce" });
  });

  it("従う・不正・例外のときは何も付けない", () => {
    expect(run(null)).toEqual({});
    expect(run("x")).toEqual({});
    expect(run("throw")).toEqual({});
  });
});
