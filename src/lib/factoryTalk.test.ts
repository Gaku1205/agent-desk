import { describe, expect, it } from "vitest";
import type { CommentData } from "./github/types";
import {
  composeFactoryAnswer,
  decodeBase64,
  decodeFactoryMark,
  emptyFactoryInput,
  encodeBase64,
  encodeFactoryMark,
  factoryAnswerText,
  FACTORY_BOT,
  isFactoryAnswered,
  parseFactoryAnswer,
  parseFactoryTalk,
  type FactoryInput,
  type FactoryTalk,
} from "./factoryTalk";

const REPO = "Gaku1205/ai-dev-template";
const ROOT = `https://raw.githubusercontent.com/${REPO}/factory-talk`;

function comment(id: number, body: string, createdAt: string, author = FACTORY_BOT, issueNumber = 5): CommentData {
  return { id, issueNumber, author, body, createdAt };
}

const ASK = {
  questions: [
    { q: "主に使う端末は？", options: ["スマホが中心", "PCが中心", "両方"], recommend: 0 },
    { q: "色の雰囲気は？", options: ["明るい", "落ち着いた"], recommend: 1 },
  ],
};

const IDEAS_STATE = {
  v: 1,
  stage: "ideas",
  round: 1,
  ideas: [
    { name: "morning-card", stack: "nextjs", title: "朝の1枚", pitch: "天気と予定を1枚に", who: "通勤する人", novel: "", paid: "", screen: "1枚のカード" },
    { name: "plan-box", stack: "saas", title: "予定箱", pitch: "予定をまとめる", who: "", novel: "通知", paid: "月500円", screen: "" },
    { name: "weather-now", stack: "python", title: "いまの天気", pitch: "天気だけ", who: "", novel: "", paid: "", screen: "" },
  ],
  assets: { ideas: "issue-5/r1-ideas" },
  ask: ASK,
};

/** 工場の render と同じ形のコメント（見た目の方向） */
function looksBody(withImages: boolean): string {
  const state = {
    stage: "looks",
    ideas: IDEAS_STATE.ideas,
    idea: 0,
    looks: [
      { n: 1, title: "夜明け", idea: "やわらかい光", colors: ["#112233", "nothex", "#AABBCC"], fonts: "明朝", refs: [] },
      { n: 2, title: "新聞", idea: "白黒", colors: [], fonts: "", refs: [] },
    ],
    assets: { ideas: "issue-5/r1-ideas", looks: "issue-5/r2-looks" },
    ask: { questions: [] },
  };
  const imgs = withImages
    ? `<img src="${ROOT}/issue-5/r2-looks/look-1-1440.png" width="720" alt="方向1">\n<img src="http://evil.example/look-2.png" alt="方向2">`
    : "";
  return `## 🎨 「朝の1枚」の見た目の方向を3つ作りました\n\n${imgs}\n\n${encodeFactoryMark(state)}`;
}

const MOCKS_STATE = {
  stage: "mocks",
  mocks: [
    { key: "a", title: "カード", note: "大きなカード" },
    { key: "b", title: "一覧", note: "行で並べる" },
  ],
  assets: { mocks: "issue-5/r3-mocks" },
  ask: { questions: [] },
};

const CONFIRM_STATE = {
  stage: "confirm",
  mock: "b",
  answers: [{ q: "主に使う端末は？", a: "スマホが中心" }],
  confirm: {
    name: "plan-box",
    stack: "saas",
    description: "予定をまとめる",
    free: ["予定3件"],
    paid: ["予定無制限", "通知"],
    price: 500,
    pages: ["トップ", "料金"],
  },
  assets: { mocks: "issue-5/r3-mocks", confirm: "issue-5/r4-confirm" },
  ask: ASK,
};

function decodeAnswerMark(body: string): unknown {
  const match = /<!-- factory-answer:([A-Za-z0-9+/=]+) -->/.exec(body);
  if (!match) return null;
  return JSON.parse(decodeBase64(match[1]) ?? "null");
}

function input(patch: Partial<FactoryInput>): FactoryInput {
  return { ...emptyFactoryInput(), ...patch };
}

describe("BASE64（UTF-8）", () => {
  it("日本語を含む文を行き来できる", () => {
    const text = '{"q":"主に使う端末は？","a":"スマホ😀"}';
    expect(decodeBase64(encodeBase64(text))).toBe(text);
  });

  it("工場（Python の base64.b64encode(json.dumps(..., ensure_ascii=False).encode())）と同じ形を読める", () => {
    // python3 -c 'import base64,json;print(base64.b64encode(json.dumps({"stage":"ideas","memo":"天気"},ensure_ascii=False,separators=(",",":")).encode()).decode())'
    expect(decodeFactoryMark("<!-- factory-talk:v1:eyJzdGFnZSI6ImlkZWFzIiwibWVtbyI6IuWkqeawlyJ9 -->")).toEqual({
      stage: "ideas",
      memo: "天気",
    });
  });

  it("壊れた BASE64・JSON でない・オブジェクトでない物は読まない", () => {
    expect(decodeFactoryMark("<!-- factory-talk:v1:@@@ -->")).toBeNull();
    expect(decodeFactoryMark(`<!-- factory-talk:v1:${encodeBase64("not json")} -->`)).toBeNull();
    expect(decodeFactoryMark(`<!-- factory-talk:v1:${encodeBase64("[1,2]")} -->`)).toBeNull();
    expect(decodeFactoryMark("印なし")).toBeNull();
  });
});

describe("工場の相談のコメントを読む", () => {
  it("いちばん新しい工場（github-actions[bot]）のコメントだけを使う。人や別の bot の印は使わない", () => {
    const comments = [
      comment(1, encodeFactoryMark({ ...IDEAS_STATE, round: 1 }), "2026-11-05T10:00:00Z"),
      comment(2, encodeFactoryMark(MOCKS_STATE), "2026-11-05T11:00:00Z", "someone"),
      comment(3, encodeFactoryMark(MOCKS_STATE), "2026-11-05T11:30:00Z", "claude[bot]"),
      comment(4, encodeFactoryMark(MOCKS_STATE), "2026-11-05T12:00:00Z", FACTORY_BOT, 6),
    ];
    const talk = parseFactoryTalk(comments, 5, REPO);
    expect(talk?.commentId).toBe(1);
    expect(talk?.stage).toBe("ideas");
  });

  it("工場の相談のコメントが無ければ null", () => {
    expect(parseFactoryTalk([comment(1, "ただのコメント", "2026-11-05T10:00:00Z")], 5, REPO)).toBeNull();
  });

  it("案：番号・題名・name・stack・紹介・使う人などの行と、質問（おすすめ）を読む", () => {
    const talk = parseFactoryTalk([comment(1, encodeFactoryMark(IDEAS_STATE), "2026-11-05T10:00:00Z")], 5, REPO);
    expect(talk?.choices.map((c) => [c.value, c.mark, c.title, c.sub])).toEqual([
      ["1", "1", "朝の1枚", "morning-card・nextjs"],
      ["2", "2", "予定箱", "plan-box・saas"],
      ["3", "3", "いまの天気", "weather-now・python"],
    ]);
    expect(talk?.choices[0].facts).toEqual([
      { label: "使う人", value: "通勤する人" },
      { label: "画面", value: "1枚のカード" },
    ]);
    expect(talk?.choices[1].facts.map((f) => f.label)).toEqual(["新しい所", "有料"]);
    expect(talk?.questions).toEqual([
      {
        number: 1,
        text: "主に使う端末は？",
        options: [
          { letter: "A", text: "スマホが中心", recommended: true },
          { letter: "B", text: "PCが中心", recommended: false },
          { letter: "C", text: "両方", recommended: false },
        ],
      },
      {
        number: 2,
        text: "色の雰囲気は？",
        options: [
          { letter: "A", text: "明るい", recommended: false },
          { letter: "B", text: "落ち着いた", recommended: true },
        ],
      },
    ]);
  });

  it("見た目の方向：画像はコメントの <img>（alt が 方向N）を使い、使えないURLなら assets から作る。色は #RRGGBB だけ", () => {
    const talk = parseFactoryTalk([comment(1, looksBody(true), "2026-11-05T10:00:00Z")], 5, REPO);
    expect(talk?.stage).toBe("looks");
    expect(talk?.choices.map((c) => c.images.map((i) => i.src))).toEqual([
      [`${ROOT}/issue-5/r2-looks/look-1-1440.png`],
      [`${ROOT}/issue-5/r2-looks/look-2-1440.png`],
    ]);
    expect(talk?.choices[0].colors).toEqual(["#112233", "#AABBCC"]);
    expect(talk?.choices[0].fonts).toBe("明朝");
  });

  it("画面：PC とスマホの画像を assets から作る（コメントに <img> が無いとき）", () => {
    const talk = parseFactoryTalk([comment(1, encodeFactoryMark(MOCKS_STATE), "2026-11-05T10:00:00Z")], 5, REPO);
    expect(talk?.choices.map((c) => [c.value, c.mark, c.images.map((i) => [i.device, i.src])])).toEqual([
      ["a", "A", [["pc", `${ROOT}/issue-5/r3-mocks/mock-a-1440.png`], ["mobile", `${ROOT}/issue-5/r3-mocks/mock-a-390.png`]]],
      ["b", "B", [["pc", `${ROOT}/issue-5/r3-mocks/mock-b-1440.png`], ["mobile", `${ROOT}/issue-5/r3-mocks/mock-b-390.png`]]],
    ]);
  });

  it("assets のパスに .. や変な文字があれば画像を作らない", () => {
    const state = { ...MOCKS_STATE, assets: { mocks: "../secret" } };
    const talk = parseFactoryTalk([comment(1, encodeFactoryMark(state), "2026-11-05T10:00:00Z")], 5, REPO);
    expect(talk?.choices.flatMap((c) => c.images)).toEqual([]);
    const odd = { ...MOCKS_STATE, assets: { mocks: "a b\"><script>" } };
    const talk2 = parseFactoryTalk([comment(1, encodeFactoryMark(odd), "2026-11-05T10:00:00Z")], 5, REPO);
    expect(talk2?.choices.flatMap((c) => c.images)).toEqual([]);
  });

  it("最終確認：まとめ（saas は無料・有料・値段）と、選んだ画面の画像（assets.mocks）", () => {
    const talk = parseFactoryTalk([comment(1, encodeFactoryMark(CONFIRM_STATE), "2026-11-05T10:00:00Z")], 5, REPO);
    expect(talk?.stage).toBe("confirm");
    expect(talk?.choices).toEqual([]);
    expect(talk?.confirm?.facts).toEqual([
      { label: "名前", value: "plan-box（saas）" },
      { label: "何のサービス", value: "予定をまとめる" },
      { label: "無料", value: "予定3件" },
      { label: "有料（月 500 円）", value: "予定無制限・通知" },
      { label: "最初に作る画面", value: "トップ・料金" },
      { label: "決まった事", value: "主に使う端末は？ → スマホが中心" },
    ]);
    expect(talk?.confirm?.images.map((i) => i.src)).toEqual([
      `${ROOT}/issue-5/r3-mocks/mock-b-1440.png`,
      `${ROOT}/issue-5/r3-mocks/mock-b-390.png`,
    ]);
  });

  it("作れなかったときのコメント（⚠️・🤔 で始まる）は、1行目をお知らせにして、同じ段階の選択肢を出す", () => {
    const body = `🤔 案は 1〜3 の番号で選んでください。\n\n${encodeFactoryMark(IDEAS_STATE)}`;
    const talk = parseFactoryTalk([comment(1, body, "2026-11-05T10:00:00Z")], 5, REPO);
    expect(talk?.notice).toBe("案は 1〜3 の番号で選んでください。");
    expect(talk?.choices).toHaveLength(3);
  });

  it("知らない段階（go など）・選択肢が読めないときは、段階を null にする（答えを書く欄だけ）", () => {
    const go = parseFactoryTalk([comment(1, encodeFactoryMark({ stage: "go" }), "2026-11-05T10:00:00Z")], 5, REPO);
    expect(go?.stage).toBeNull();
    const empty = parseFactoryTalk([comment(1, encodeFactoryMark({ stage: "ideas", ideas: [] }), "2026-11-05T10:00:00Z")], 5, REPO);
    expect(empty?.stage).toBeNull();
    expect(empty?.questions).toEqual([]);
  });
});

describe("答えたか", () => {
  const talk = comment(1, encodeFactoryMark(IDEAS_STATE), "2026-11-05T10:00:00Z");
  it("工場の相談のあとに人のコメントがあれば答えた", () => {
    expect(isFactoryAnswered([talk, comment(2, "2", "2026-11-05T10:05:00Z", "gaku")], 5)).toBe(true);
  });
  it("bot のコメント・前のコメント・別のIssueのコメントは数えない", () => {
    expect(
      isFactoryAnswered(
        [
          comment(0, "前の返事", "2026-11-05T09:00:00Z", "gaku"),
          talk,
          comment(2, "通知", "2026-11-05T10:05:00Z", "claude[bot]"),
          comment(3, "別", "2026-11-05T10:06:00Z", "gaku", 6),
        ],
        5,
      ),
    ).toBe(false);
  });
  it("工場の相談のコメントが無ければ答えていない", () => {
    expect(isFactoryAnswered([comment(2, "2", "2026-11-05T10:05:00Z", "gaku")], 5)).toBe(false);
  });
});

describe("答えを組み立てる", () => {
  const ideas = parseFactoryTalk([comment(1, encodeFactoryMark(IDEAS_STATE), "2026-11-05T10:00:00Z")], 5, REPO) as FactoryTalk;
  const looks = parseFactoryTalk([comment(1, looksBody(false), "2026-11-05T10:00:00Z")], 5, REPO) as FactoryTalk;
  const mocks = parseFactoryTalk([comment(1, encodeFactoryMark(MOCKS_STATE), "2026-11-05T10:00:00Z")], 5, REPO) as FactoryTalk;
  const confirm = parseFactoryTalk([comment(1, encodeFactoryMark(CONFIRM_STATE), "2026-11-05T10:00:00Z")], 5, REPO) as FactoryTalk;

  it("案を1つ選び、質問に答える：「案2を選ぶ。Q1：スマホが中心」と印（pick・choice 2・answers）", () => {
    const value = input({ pick: "2", answers: { 1: { choice: "A", note: "" } } });
    const body = composeFactoryAnswer(ideas, value);
    expect(body.split("\n\n")[0]).toBe("案2を選ぶ。Q1：スマホが中心");
    expect(decodeAnswerMark(body)).toEqual({
      action: "pick",
      choice: "2",
      answers: [{ q: "主に使う端末は？", a: "スマホが中心" }],
      note: "",
    });
    expect(factoryAnswerText(ideas, value)).toBe("案2を選ぶ。Q1：スマホが中心");
  });

  it("選択肢に自分で書き足した・書いただけの答えと、ほかに伝えたいこと（注文）", () => {
    const value = input({
      pick: "1",
      answers: { 1: { choice: "B", note: "家でも見る。" }, 2: { choice: null, note: "青っぽく" } },
      note: "名前はもっと短く",
    });
    const body = composeFactoryAnswer(ideas, value);
    expect(body.split("\n\n").slice(0, 2)).toEqual(["案1を選ぶ。Q1：PCが中心：家でも見る。Q2：青っぽく", "名前はもっと短く"]);
    expect(decodeAnswerMark(body)).toEqual({
      action: "pick",
      choice: "1",
      answers: [
        { q: "主に使う端末は？", a: "PCが中心：家でも見る" },
        { q: "色の雰囲気は？", a: "青っぽく" },
      ],
      note: "名前はもっと短く",
    });
  });

  it("見た目の方向・画面を選ぶ（choice は 1・a）", () => {
    expect(factoryAnswerText(looks, input({ pick: "1" }))).toBe("見た目の方向1を選ぶ");
    expect(decodeAnswerMark(composeFactoryAnswer(looks, input({ pick: "1" })))).toMatchObject({ action: "pick", choice: "1" });
    expect(factoryAnswerText(mocks, input({ pick: "b" }))).toBe("画面Bを選ぶ");
    expect(decodeAnswerMark(composeFactoryAnswer(mocks, input({ pick: "b" })))).toMatchObject({ action: "pick", choice: "b" });
  });

  it("全部ちがう：redo・choice null・注文はどう変えてほしいか（書かないと送れない）", () => {
    expect(composeFactoryAnswer(ideas, input({ pick: "redo" }))).toBe("");
    const body = composeFactoryAnswer(ideas, input({ pick: "redo", redoNote: "もっと遊べる物。", note: "使わない" }));
    expect(body.split("\n\n")[0]).toBe("全部ちがう：もっと遊べる物");
    expect(decodeAnswerMark(body)).toEqual({ action: "redo", choice: null, answers: [], note: "もっと遊べる物" });
  });

  it("最終確認：作る（go）と、直す（redo・内容を書く）", () => {
    const go = composeFactoryAnswer(confirm, input({ pick: "go" }));
    expect(go.split("\n\n")[0]).toBe("作る");
    expect(decodeAnswerMark(go)).toEqual({ action: "go", choice: null, answers: [], note: "" });
    expect(composeFactoryAnswer(confirm, input({ pick: "fix" }))).toBe("");
    const fix = composeFactoryAnswer(confirm, input({ pick: "fix", redoNote: "値段を300円に" }));
    expect(fix.split("\n\n")[0]).toBe("直す：値段を300円に");
    expect(decodeAnswerMark(fix)).toEqual({ action: "redo", choice: null, answers: [], note: "値段を300円に" });
  });

  it("段階に合わない選び方・何も選んでいないときは空（送らない）", () => {
    expect(composeFactoryAnswer(ideas, input({}))).toBe("");
    expect(composeFactoryAnswer(ideas, input({ answers: { 1: { choice: "A", note: "" } } }))).toBe("");
    expect(composeFactoryAnswer(ideas, input({ pick: "9" }))).toBe("");
    expect(composeFactoryAnswer(ideas, input({ pick: "go" }))).toBe("");
    expect(composeFactoryAnswer(ideas, input({ pick: "fix", redoNote: "x" }))).toBe("");
    expect(composeFactoryAnswer(confirm, input({ pick: "redo", redoNote: "x" }))).toBe("");
    expect(composeFactoryAnswer(confirm, input({ pick: "1" }))).toBe("");
  });

  it("段階が読めないときは、書いた文だけ（印なし）", () => {
    const unknown: Pick<FactoryTalk, "stage" | "choices" | "questions"> = { stage: null, choices: [], questions: [] };
    expect(composeFactoryAnswer(unknown, input({ note: " もう一回 " }))).toBe("もう一回");
    expect(composeFactoryAnswer(unknown, input({}))).toBe("");
  });

  it("注文は400文字で切る", () => {
    const body = composeFactoryAnswer(ideas, input({ pick: "redo", redoNote: "あ".repeat(500) }));
    expect((decodeAnswerMark(body) as { note: string }).note).toHaveLength(400);
  });
});

describe("印を読む（サーバーで確かめる）", () => {
  it("組み立てた印は読める", () => {
    const ideas = parseFactoryTalk([comment(1, encodeFactoryMark(IDEAS_STATE), "2026-11-05T10:00:00Z")], 5, REPO) as FactoryTalk;
    expect(parseFactoryAnswer(composeFactoryAnswer(ideas, input({ pick: "3" })))).toEqual({
      action: "pick",
      choice: "3",
      answers: [],
      note: "",
    });
  });
  it("印が無ければ null、読めない・action が違えば invalid", () => {
    expect(parseFactoryAnswer("2")).toBeNull();
    expect(parseFactoryAnswer("<!-- factory-answer:@@ -->")).toBeNull();
    expect(parseFactoryAnswer(`<!-- factory-answer:${encodeBase64("nope")} -->`)).toBe("invalid");
    expect(parseFactoryAnswer(`<!-- factory-answer:${encodeBase64('{"action":"back"}')} -->`)).toBe("invalid");
  });
});
