import { describe, expect, it } from "vitest";
import { calmCopy } from "./homeCalm";

describe("calmCopy", () => {
  it("全部読めたときは、決めることが無いと言い、緑のチェックを出す", () => {
    expect(calmCopy(false)).toEqual({
      title: "決めることは、今はありません",
      description: "AIたちが進めています。決めることが出たら、ここに出ます。",
      check: true,
    });
  });

  it("読めなかったリポジトリがあるときは、言い切らず、チェックを出さない", () => {
    const copy = calmCopy(true);
    expect(copy.title).toBe("読めなかったリポジトリがあります");
    expect(copy.check).toBe(false);
  });
});
