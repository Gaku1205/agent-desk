import { describe, expect, it } from "vitest";
import { isExternalUrl } from "./externalUrl";

describe("isExternalUrl", () => {
  it("http・https で始まるURLは外のサイト", () => {
    expect(isExternalUrl("https://github.com/Gaku1205/agent-desk/issues/1")).toBe(true);
    expect(isExternalUrl("http://example.com")).toBe(true);
    expect(isExternalUrl("HTTPS://example.com")).toBe(true);
  });

  it("アプリの中のページ（/ で始まる）は外ではない", () => {
    expect(isExternalUrl("/demo/repos/demo/todo-app")).toBe(false);
    expect(isExternalUrl("/")).toBe(false);
    expect(isExternalUrl("/repos/a/b#section")).toBe(false);
  });
});
