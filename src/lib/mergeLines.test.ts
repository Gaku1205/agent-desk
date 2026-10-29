import { describe, expect, it } from "vitest";
import { mergeResultLines } from "./mergeLines";

describe("mergeResultLines", () => {
  it("CI・レビュー・公開の3行", () => {
    expect(mergeResultLines({ pullNumber: 19, base: "main", ci: { passed: 4, total: 4 }, review: "clean" })).toEqual([
      "✓ check   4/4 通過",
      "✓ review  指摘なし",
      "→ deploy  マージ後にVercelが公開",
    ]);
  });

  it("レビューしていなければ未実施、指摘があれば指摘あり", () => {
    expect(mergeResultLines({ pullNumber: 1, base: "main", ci: { passed: 3, total: 4 }, review: null })[1]).toBe(
      "– review  未実施",
    );
    expect(mergeResultLines({ pullNumber: 1, base: "main", ci: { passed: 4, total: 4 }, review: "issues" })[1]).toBe(
      "× review  指摘あり",
    );
  });
});
