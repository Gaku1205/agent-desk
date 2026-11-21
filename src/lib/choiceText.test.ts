import { describe, expect, it } from "vitest";
import { codeParts, presetAnswer, splitChoice } from "./choiceText";
import type { ParsedQuestion } from "./question";

describe("splitChoice", () => {
  it("最初の「。」までを見出し、残りを説明にする", () => {
    expect(splitChoice("緑の行の数に合わせる。やり直し待ち・マージ待ちも数に入る")).toEqual({
      head: "緑の行の数に合わせる",
      body: "やり直し待ち・マージ待ちも数に入る",
      recommended: false,
    });
  });

  it("「。」が無ければ「（」の前までを見出しにし、外の括弧を外す", () => {
    expect(splitChoice("名前だけ変える（数のずれは残る）")).toEqual({
      head: "名前だけ変える",
      body: "数のずれは残る",
      recommended: false,
    });
  });

  it("（おすすめ）は文から外して印にする", () => {
    expect(splitChoice("緑の行の数に合わせる（おすすめ）。数に入る")).toEqual({
      head: "緑の行の数に合わせる",
      body: "数に入る",
      recommended: true,
    });
    expect(splitChoice("(おすすめ) そのまま")).toEqual({ head: "そのまま", body: "", recommended: true });
  });

  it("分けられなければ全文を見出しにする", () => {
    expect(splitChoice("今の数え方に、緑の方をそろえる")).toEqual({
      head: "今の数え方に、緑の方をそろえる",
      body: "",
      recommended: false,
    });
    expect(splitChoice("（全部）")).toEqual({ head: "（全部）", body: "", recommended: false });
  });

  it("文の最後の「。」だけなら、説明は空", () => {
    expect(splitChoice("名前だけ変える。")).toEqual({ head: "名前だけ変える", body: "", recommended: false });
  });

  it("説明の中に括弧が残るときは外さない", () => {
    expect(splitChoice("変える。（A）と（B）")).toEqual({ head: "変える", body: "（A）と（B）", recommended: false });
  });
});

describe("codeParts", () => {
  it("バッククォートの中をコードの一切れにする", () => {
    expect(codeParts("左のバーの `AI` の数")).toEqual([
      { text: "左のバーの ", code: false },
      { text: "AI", code: true },
      { text: " の数", code: false },
    ]);
  });

  it("閉じていないバッククォートはそのまま", () => {
    expect(codeParts("a `b")).toEqual([{ text: "a `b", code: false }]);
    expect(codeParts("")).toEqual([]);
  });
});

describe("presetAnswer", () => {
  it("おすすめの選択肢を最初から選ぶ", () => {
    const question = {
      questions: [
        {
          number: 1,
          text: "どれ？",
          options: [
            { letter: "A", text: "a", recommended: false },
            { letter: "B", text: "b", recommended: true },
          ],
        },
        { number: 2, text: "自由に", options: [] },
      ],
      mockups: [],
    } as unknown as ParsedQuestion;
    expect(presetAnswer(question)).toEqual({ mockup: null, answers: { 1: { choice: "B", note: "" } }, note: "" });
    expect(presetAnswer(null)).toEqual({ mockup: null, answers: {}, note: "" });
  });
});
