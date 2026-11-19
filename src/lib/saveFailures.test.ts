import { describe, expect, it } from "vitest";
import { summarizeSaveFailures } from "./saveFailures";

const f = (name: string, message: string) => ({ name, message });

describe("summarizeSaveFailures", () => {
  it("失敗が無ければ空", () => {
    expect(summarizeSaveFailures([], 3)).toEqual([]);
  });
  it("全部同じ理由なら1行（件数つき・titleに名前の一覧）", () => {
    const names = ["a/1", "a/2", "a/3", "a/4", "a/5", "a/6"];
    expect(summarizeSaveFailures(names.map((n) => f(n, "設定を保存できませんでした")), 6)).toEqual([
      { text: "設定を保存できませんでした（6件）", title: names.join("、") },
    ]);
  });
  it("理由が違えば理由ごとに1行（出てきた順）", () => {
    expect(
      summarizeSaveFailures([f("a/1", "X"), f("a/2", "Y"), f("a/3", "X")], 3),
    ).toEqual([
      { text: "X（2件）", title: "a/1、a/3" },
      { text: "a/2：Y" },
    ]);
  });
  it("書く先が1つだけなら理由だけ", () => {
    expect(summarizeSaveFailures([f("a/1", "X")], 1)).toEqual([{ text: "X" }]);
  });
  it("複数に書いて1つだけ失敗したらリポジトリ名を付ける", () => {
    expect(summarizeSaveFailures([f("a/1", "X")], 3)).toEqual([{ text: "a/1：X" }]);
  });
});
