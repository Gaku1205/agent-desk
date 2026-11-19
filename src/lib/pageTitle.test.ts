import { describe, expect, it } from "vitest";
import { pageTitle } from "./pageTitle";

describe("pageTitle", () => {
  it("ページごとの名前", () => {
    expect(pageTitle("/")).toBe("ホーム");
    expect(pageTitle("/dashboard")).toBe("Dashboard");
    expect(pageTitle("/lanes")).toBe("Slots & Queue");
    expect(pageTitle("/repos")).toBe("すべてのリポジトリ");
    expect(pageTitle("/repos/Gaku1205/todo-app")).toBe("todo-app");
    expect(pageTitle("/settings")).toBe("設定");
    expect(pageTitle("/new/service")).toBe("新サービス");
    expect(pageTitle("/setup")).toBe("Setup");
  });

  it("どれにも当たらないパス（見つからないページ）は 見つかりません", () => {
    expect(pageTitle("/somewhere")).toBe("見つかりません");
    expect(pageTitle("/demo/nope", "/demo")).toBe("見つかりません");
  });

  it("デモは /demo を除いて決める", () => {
    expect(pageTitle("/demo", "/demo")).toBe("ホーム");
    expect(pageTitle("/demo/lanes", "/demo")).toBe("Slots & Queue");
    expect(pageTitle("/demo/repos/Gaku1205/todo-app", "/demo")).toBe("todo-app");
  });
});
