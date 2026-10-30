import { describe, expect, it } from "vitest";
import { rovingNext } from "./roving";

describe("rovingNext", () => {
  it("→↓ で次へ、端では先頭へ回る", () => {
    expect(rovingNext("ArrowRight", 0, 3)).toBe(1);
    expect(rovingNext("ArrowDown", 1, 3)).toBe(2);
    expect(rovingNext("ArrowRight", 2, 3)).toBe(0);
  });
  it("←↑ で前へ、先頭では末尾へ回る", () => {
    expect(rovingNext("ArrowLeft", 2, 3)).toBe(1);
    expect(rovingNext("ArrowUp", 0, 3)).toBe(2);
  });
  it("Home は先頭、End は末尾", () => {
    expect(rovingNext("Home", 2, 3)).toBe(0);
    expect(rovingNext("End", 0, 3)).toBe(2);
  });
  it("ほかのキーと空の一覧は動かさない", () => {
    expect(rovingNext("a", 0, 3)).toBeNull();
    expect(rovingNext("ArrowRight", 0, 0)).toBeNull();
  });
});
