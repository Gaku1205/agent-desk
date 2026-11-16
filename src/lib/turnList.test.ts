import { describe, expect, it } from "vitest";
import { isTurnListFoldable, pickTurn } from "./turnList";

const item = (number: number) => ({ owner: "o", repo: "r", issue: { number, title: "", url: "" } });

describe("pickTurn", () => {
  const waiting = [item(1), item(2), item(3)];

  it("選んでいなければ先頭", () => {
    expect(pickTurn(waiting, null)?.issue.number).toBe(1);
  });

  it("選んだ物があればそれ", () => {
    expect(pickTurn(waiting, "o/r#3")?.issue.number).toBe(3);
  });

  it("選んだ物が無くなったら先頭に戻る", () => {
    expect(pickTurn([item(1), item(2)], "o/r#3")?.issue.number).toBe(1);
  });

  it("1件も無ければ null", () => {
    expect(pickTurn([], "o/r#3")).toBeNull();
  });
});

describe("isTurnListFoldable", () => {
  it("6件以上で畳める", () => {
    expect(isTurnListFoldable(5)).toBe(false);
    expect(isTurnListFoldable(6)).toBe(true);
  });
});
