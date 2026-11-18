import { describe, expect, it } from "vitest";
import { parseTouches, touchesOverlap } from "./touches";

describe("parseTouches", () => {
  it("本文の印から、触るファイルを読む（前後の空白・重なりを除く）", () => {
    expect(parseTouches("本文\n<!-- ai-touches: src/lib/a.ts, src/components/ , src/lib/a.ts -->")).toEqual([
      "src/lib/a.ts",
      "src/components/",
    ]);
  });

  it("印が無い・中身が空なら null", () => {
    expect(parseTouches("本文だけ")).toBeNull();
    expect(parseTouches("<!-- ai-touches: -->")).toBeNull();
  });
});

describe("touchesOverlap", () => {
  it("同じファイルなら、そのファイル", () => {
    expect(touchesOverlap(["src/a.ts", "src/b.ts"], ["src/b.ts"])).toBe("src/b.ts");
  });

  it("フォルダの中にもう片方があれば、ファイルの方を返す", () => {
    expect(touchesOverlap(["src/components/"], ["src/components/Sidebar.tsx"])).toBe("src/components/Sidebar.tsx");
    expect(touchesOverlap(["src/components/Sidebar.tsx"], ["src/components/"])).toBe("src/components/Sidebar.tsx");
  });

  it("重ならなければ null。docs/ の下の .md は数えない", () => {
    expect(touchesOverlap(["src/a.ts"], ["src/b.ts"])).toBeNull();
    expect(touchesOverlap(["docs/spec.md"], ["docs/spec.md"])).toBeNull();
    expect(touchesOverlap(["src/componentsX.ts"], ["src/components/"])).toBeNull();
  });
});
