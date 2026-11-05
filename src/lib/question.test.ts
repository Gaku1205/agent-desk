import { describe, expect, it } from "vitest";
import type { CommentData } from "./github/types";
import {
  composeAnswer,
  isQuestionAnswered,
  isQuestionComment,
  isValidAnswer,
  MAX_ANSWER_LENGTH,
  parseMockups,
  parseQuestionComment,
  parseQuestions,
} from "./question";

function comment(partial: Partial<CommentData>): CommentData {
  return {
    id: 1,
    issueNumber: 5,
    author: "claude[bot]",
    body: "",
    createdAt: "2026-11-05T10:00:00Z",
    ...partial,
  };
}

const QUESTION_BODY = [
  "<!-- ai-question -->",
  "企画AIから質問です。",
  "",
  "**Q1. 色の雰囲気は？**",
  "- A. 落ち着いた（おすすめ）",
  "- B. 明るい",
  "",
  "**Q2.** 一覧の並び順は？",
  "- A. 新しい順",
  "- B. 古い順（おすすめ）",
].join("\n");

describe("isQuestionComment", () => {
  it("1行目が質問の印のコメントだけ", () => {
    expect(isQuestionComment({ body: "<!-- ai-question -->\n質問" })).toBe(true);
    expect(isQuestionComment({ body: "<!-- ai:question -->\n質問" })).toBe(true);
    expect(isQuestionComment({ body: "  <!--question-->\n質問" })).toBe(true);
    expect(isQuestionComment({ body: "質問です\n<!-- ai-question -->" })).toBe(false);
    expect(isQuestionComment({ body: "<!-- human-request -->\nお願い" })).toBe(false);
  });
});

describe("parseQuestions", () => {
  it("Q の行と、その下の選択肢を読む（おすすめに印）", () => {
    expect(parseQuestions(QUESTION_BODY)).toEqual([
      {
        number: 1,
        text: "色の雰囲気は？",
        options: [
          { letter: "A", text: "落ち着いた", recommended: true },
          { letter: "B", text: "明るい", recommended: false },
        ],
      },
      {
        number: 2,
        text: "一覧の並び順は？",
        options: [
          { letter: "A", text: "新しい順", recommended: false },
          { letter: "B", text: "古い順", recommended: true },
        ],
      },
    ]);
  });

  it("選択肢の無い質問も読む。Q より前の箇条書きは選択肢にしない", () => {
    const body = "- A. 関係ない\n**Q1. 自由に教えてください**\n説明の文";
    expect(parseQuestions(body)).toEqual([{ number: 1, text: "自由に教えてください", options: [] }]);
  });

  it("半角の (おすすめ) と CRLF も読む", () => {
    const body = "**Q1. どれ？**\r\n- A. 一つ目 (おすすめ)\r\n- B. 二つ目";
    expect(parseQuestions(body)[0].options).toEqual([
      { letter: "A", text: "一つ目", recommended: true },
      { letter: "B", text: "二つ目", recommended: false },
    ]);
  });

  it("見出しのあとの箇条書きは選択肢にしない", () => {
    const body = "**Q1. どれ？**\n- A. 一つ目\n### 補足\n- B. 補足の箇条書き";
    expect(parseQuestions(body)[0].options).toHaveLength(1);
  });
});

describe("parseMockups", () => {
  it("見出しの A・B ごとに、PC とスマホの画像を読む", () => {
    const body = [
      "<!-- mockups -->",
      "### A. 落ち着いた",
      '<img src="https://example.com/a-pc.png" alt="A PC" width="600">',
      '<img src="https://example.com/a-sp.png" alt="A スマホ">',
      "### B. 明るい",
      "<img src='https://example.com/b-pc.png' alt='B PC'>",
      '<img src="https://example.com/b-sp.png" alt="B mobile">',
    ].join("\n");
    expect(parseMockups(body)).toEqual([
      {
        letter: "A",
        label: "落ち着いた",
        images: [
          { src: "https://example.com/a-pc.png", alt: "A PC", device: "pc" },
          { src: "https://example.com/a-sp.png", alt: "A スマホ", device: "mobile" },
        ],
      },
      {
        letter: "B",
        label: "明るい",
        images: [
          { src: "https://example.com/b-pc.png", alt: "B PC", device: "pc" },
          { src: "https://example.com/b-sp.png", alt: "B mobile", device: "mobile" },
        ],
      },
    ]);
  });

  it("印が無ければ空。https 以外の画像は使わない", () => {
    expect(parseMockups('<img src="https://example.com/a.png">')).toEqual([]);
    expect(parseMockups('<!-- mockups -->\n<img src="javascript:alert(1)">\n<img src="http://x.test/a.png">')).toEqual(
      [],
    );
  });

  it("同じサイトの / で始まるパスは使う。// で始まる物は使わない", () => {
    const body = '<!-- mockups -->\n<img src="/demo/a.svg">\n<img src="//evil.test/b.png">';
    expect(parseMockups(body).flatMap((m) => m.images.map((i) => i.src))).toEqual(["/demo/a.svg"]);
  });

  it("見出しが無い画像は、前半を A、後半を B にする", () => {
    const body = [
      "<!-- mockups -->",
      '<img src="https://e.test/1.png"> <img src="https://e.test/2.png">',
      '<img src="https://e.test/3.png"> <img src="https://e.test/4.png">',
    ].join("\n");
    const result = parseMockups(body);
    expect(result.map((m) => [m.letter, m.images.map((i) => i.src)])).toEqual([
      ["A", ["https://e.test/1.png", "https://e.test/2.png"]],
      ["B", ["https://e.test/3.png", "https://e.test/4.png"]],
    ]);
  });

  it("見出しと同じ行の画像も、その案に入れる", () => {
    const body = '<!-- mockups -->\n**A案** <img src="https://e.test/a.png">\n**B案** <img src="https://e.test/b.png">';
    expect(parseMockups(body).map((m) => [m.letter, m.images.length])).toEqual([
      ["A", 1],
      ["B", 1],
    ]);
  });

  it("画面案を置くスクリプトが書く形（ai-mocks の印・1行に PC とスマホの画像が2つ）を読む", () => {
    const raw = "https://raw.githubusercontent.com/o/r/ai-mocks/issue-9/r1";
    const body = [
      "<!-- ai-question -->",
      "<!-- ai-mocks: issue-9/r1 -->",
      "## 🖼 作る前に、画面を2案作りました（左が PC、右がスマホ）",
      "",
      "### A. 写真を大きく",
      "余白を広く取った案",
      "",
      `<img src="${raw}/mock-a-1440.png" width="560" alt="A PC"> <img src="${raw}/mock-a-390.png" width="150" alt="A スマホ">`,
      "",
      "### B. 文字を大きく",
      "文字中心の案",
      "",
      `<img src="${raw}/mock-b-1440.png" width="560" alt="B PC"> <img src="${raw}/mock-b-390.png" width="150" alt="B スマホ">`,
      "",
      "## ❓ 質問",
      "",
      "**Q1. 色は？**",
      "- A. 夜（おすすめ）",
      "- B. 昼",
    ].join("\n");
    expect(parseMockups(body).map((m) => [m.letter, m.label, m.images.map((i) => [i.src, i.device])])).toEqual([
      ["A", "写真を大きく", [[`${raw}/mock-a-1440.png`, "pc"], [`${raw}/mock-a-390.png`, "mobile"]]],
      ["B", "文字を大きく", [[`${raw}/mock-b-1440.png`, "pc"], [`${raw}/mock-b-390.png`, "mobile"]]],
    ]);
  });
});

describe("parseQuestionComment", () => {
  it("いちばん新しい質問のコメントだけを読む", () => {
    const comments = [
      comment({ id: 1, body: "<!-- ai-question -->\n**Q1. 古い質問**", createdAt: "2026-11-05T09:00:00Z" }),
      comment({ id: 2, body: QUESTION_BODY, createdAt: "2026-11-05T10:00:00Z" }),
      comment({ id: 3, issueNumber: 6, body: "<!-- ai-question -->\n**Q1. 別のIssue**", createdAt: "2026-11-05T11:00:00Z" }),
    ];
    const parsed = parseQuestionComment(comments, 5);
    expect(parsed?.commentId).toBe(2);
    expect(parsed?.questions.map((q) => q.text)).toEqual(["色の雰囲気は？", "一覧の並び順は？"]);
    expect(parsed?.mockups).toEqual([]);
  });

  it("質問のコメントが無ければ null", () => {
    expect(parseQuestionComment([comment({ body: "ふつうのコメント" })], 5)).toBeNull();
  });
});

describe("isQuestionAnswered", () => {
  const question = comment({ body: QUESTION_BODY, createdAt: "2026-11-05T10:00:00Z" });

  it("質問のあとに人のコメントがあれば答えた", () => {
    const answer = comment({ id: 9, author: "owner", body: "A", createdAt: "2026-11-05T10:05:00Z" });
    expect(isQuestionAnswered([question, answer], 5)).toBe(true);
  });

  it("質問より前の人のコメント・bot のコメント・別のIssueのコメントは数えない", () => {
    const before = comment({ id: 8, author: "owner", createdAt: "2026-11-05T09:00:00Z" });
    const bot = comment({ id: 9, author: "github-actions[bot]", createdAt: "2026-11-05T10:05:00Z" });
    const other = comment({ id: 10, issueNumber: 6, author: "owner", createdAt: "2026-11-05T10:05:00Z" });
    expect(isQuestionAnswered([before, question, bot, other], 5)).toBe(false);
  });

  it("質問のコメントが無ければ false", () => {
    expect(isQuestionAnswered([comment({ author: "owner" })], 5)).toBe(false);
  });
});

describe("composeAnswer", () => {
  const question = {
    questions: parseQuestions(QUESTION_BODY),
    mockups: [
      { letter: "A" as const, label: "", images: [] },
      { letter: "B" as const, label: "", images: [] },
    ],
  };

  it("画面案と選んだ選択肢を、人が読める文にする", () => {
    expect(
      composeAnswer(question, {
        mockup: "A",
        answers: { 1: { choice: "B", note: "" } },
        note: "",
      }),
    ).toBe("A。Q1はB（明るい）");
  });

  it("自由な注文を、選択肢のあと・質問ごと・最後に付ける", () => {
    expect(
      composeAnswer(question, {
        mockup: null,
        answers: { 1: { choice: "A", note: "もう少し青く。" }, 2: { choice: null, note: "更新の新しい順" } },
        note: "  ほかはおまかせします  ",
      }),
    ).toBe("Q1はA（落ち着いた）：もう少し青く。Q2：更新の新しい順\n\nほかはおまかせします");
  });

  it("無い選択肢・無い画面案は使わない。何も無ければ空文字", () => {
    expect(composeAnswer(question, { mockup: "C", answers: { 1: { choice: "Z", note: " " } }, note: "" })).toBe("");
    expect(composeAnswer(question, { mockup: null, answers: {}, note: "自由に" })).toBe("自由に");
  });
});

describe("isValidAnswer", () => {
  it("空でなく、長すぎない文字列だけ", () => {
    expect(isValidAnswer("A")).toBe(true);
    expect(isValidAnswer("  ")).toBe(false);
    expect(isValidAnswer(1)).toBe(false);
    expect(isValidAnswer("あ".repeat(MAX_ANSWER_LENGTH + 1))).toBe(false);
  });
});
