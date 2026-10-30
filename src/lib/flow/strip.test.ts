import { describe, expect, it } from "vitest";
import { stripItemUrgent, stripPickAction } from "./strip";

describe("stripPickAction", () => {
  it("押す列に行があれば飛ぶ", () => {
    expect(stripPickAction(true)).toBe("jump");
  });
  it("行が無ければ説明を固定で出す", () => {
    expect(stripPickAction(false)).toBe("pin");
  });
});

describe("stripItemUrgent", () => {
  it("急ぐ物だけ色を付ける", () => {
    expect(stripItemUrgent({ urgent: true })).toBe(true);
    expect(stripItemUrgent({ urgent: false })).toBe(false);
  });
});
