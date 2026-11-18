import { describe, expect, it } from "vitest";
import { avatarInitial, avatarUrl } from "./avatar";

describe("avatarInitial", () => {
  it("先頭の1字を大文字にする", () => {
    expect(avatarInitial("gaku1205")).toBe("G");
    expect(avatarInitial("Octocat")).toBe("O");
  });

  it("空なら ? を返す", () => {
    expect(avatarInitial("")).toBe("?");
    expect(avatarInitial("   ")).toBe("?");
  });

  it("数字・記号はそのまま", () => {
    expect(avatarInitial("1abc")).toBe("1");
  });
});

describe("avatarUrl", () => {
  it("github.com の png を size つきで指す", () => {
    expect(avatarUrl("gaku1205")).toBe("https://github.com/gaku1205.png?size=48");
  });

  it("ログイン名を encodeURIComponent する", () => {
    expect(avatarUrl("a/b c")).toBe("https://github.com/a%2Fb%20c.png?size=48");
  });
});
