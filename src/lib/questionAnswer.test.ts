import { describe, expect, it } from "vitest";
import type { AnswerInput, QuestionItem } from "./question";
import {
  canAnswerAllRecommended,
  composeRecommendedAnswer,
  hasOtherPick,
  questionTabLabel,
  recommendedSummary,
  shortQuestionName,
} from "./questionAnswer";

const questions: QuestionItem[] = [
  {
    number: 1,
    text: "数える時間は何で測りますか",
    options: [
      { letter: "A", text: "壁の時計。実際に経った時間", recommended: false },
      { letter: "B", text: "CPU の時間。処理の重さ", recommended: true },
    ],
  },
  {
    number: 2,
    text: "残す場所を決めてください",
    options: [
      { letter: "A", text: "ファイル", recommended: false },
      { letter: "B", text: "Issue のコメント（見える）", recommended: true },
    ],
  },
  {
    number: 3,
    text: "書く役はだれですか",
    options: [
      { letter: "A", text: "30分ごとの点検", recommended: true },
      { letter: "B", text: "毎回", recommended: false },
    ],
  },
];

const noMock = { questions, mockups: [] };
const empty: AnswerInput = { mockup: null, answers: {}, note: "" };

describe("shortQuestionName", () => {
  it("最初の「は」「を」の前まで", () => {
    expect(shortQuestionName("数える時間は何ですか")).toBe("数える時間");
    expect(shortQuestionName("残す場所を決めて")).toBe("残す場所");
  });
  it("20字を超える・前が空・見つからないときは空文字", () => {
    expect(shortQuestionName("あ".repeat(21) + "は")).toBe("");
    expect(shortQuestionName("あ".repeat(20) + "は")).toBe("あ".repeat(20));
    expect(shortQuestionName("は何ですか")).toBe("");
    expect(shortQuestionName("どうしますか")).toBe("");
  });
  it("切り替えの文字は取れなければ Q1 だけ", () => {
    expect(questionTabLabel({ number: 1, text: "数える時間は" })).toBe("Q1 数える時間");
    expect(questionTabLabel({ number: 2, text: "どうする" })).toBe("Q2");
  });
});

describe("canAnswerAllRecommended", () => {
  it("2問以上で全部におすすめがあれば true", () => {
    expect(canAnswerAllRecommended(questions)).toBe(true);
  });
  it("1問だけ・おすすめの無い問いがあれば false", () => {
    expect(canAnswerAllRecommended(questions.slice(0, 1))).toBe(false);
    const noRec = [questions[0], { ...questions[1], options: questions[1].options.map((o) => ({ ...o, recommended: false })) }];
    expect(canAnswerAllRecommended(noRec)).toBe(false);
  });
});

describe("composeRecommendedAnswer", () => {
  it("全部おすすめ：Q1はB、Q2はB、Q3はA", () => {
    expect(composeRecommendedAnswer(noMock, empty)).toBe("Q1はB、Q2はB、Q3はA");
  });
  it("選んでいる物を優先し、残りをおすすめで埋める", () => {
    const input: AnswerInput = { ...empty, answers: { 2: { choice: "A", note: "" } } };
    expect(composeRecommendedAnswer(noMock, input)).toBe("Q1はB、Q2はA、Q3はA");
  });
  it("補足・ほかに伝えたいこと・画面案を残す", () => {
    const input: AnswerInput = {
      mockup: "B",
      answers: { 1: { choice: "B", note: "早めに。" } },
      note: "お願いします",
    };
    const withMock = { questions, mockups: [{ letter: "B" as const, label: "", images: [] }] };
    expect(composeRecommendedAnswer(withMock, input)).toBe("B。Q1はB：早めに、Q2はB、Q3はA\n\nお願いします");
  });
  it("おすすめの無い問いがあれば null", () => {
    const noRec = { questions: [questions[0], { ...questions[1], options: [] }], mockups: [] };
    expect(composeRecommendedAnswer(noRec, empty)).toBeNull();
  });
});

describe("recommendedSummary", () => {
  it("選択肢の見出しを Q の番号と並べる", () => {
    expect(recommendedSummary(questions, {})).toBe("Q1 CPU の時間 · Q2 Issue のコメント · Q3 30分ごとの点検");
  });
  it("選んでいる物＋残りのおすすめにする", () => {
    expect(recommendedSummary(questions, { 3: { choice: "B", note: "" } })).toBe(
      "Q1 CPU の時間 · Q2 Issue のコメント · Q3 毎回",
    );
  });
  it("おすすめの無い問いがあれば null", () => {
    expect(recommendedSummary([{ ...questions[0], options: [] }], {})).toBeNull();
  });
});

describe("hasOtherPick", () => {
  it("おすすめ以外を選んでいれば true、おすすめや未選択なら false", () => {
    expect(hasOtherPick(questions, { 1: { choice: "A", note: "" } })).toBe(true);
    expect(hasOtherPick(questions, { 1: { choice: "B", note: "" } })).toBe(false);
    expect(hasOtherPick(questions, { 1: { choice: null, note: "" } })).toBe(false);
  });
});
