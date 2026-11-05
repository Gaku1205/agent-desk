import { decodeFactoryMark, encodeFactoryMark, parseFactoryAnswer, type FactoryStage } from "../factoryTalk";

/**
 * デモの工場の相談（docs/spec.md の「デモ」）。工場（`factory-talk.yml`）の代わりに、
 * 段階ごとの相談のコメント（印つき）を作る。画像は public/factory/ と public/mockups/ の見本
 */

type State = Record<string, unknown>;

const IDEAS = [
  {
    name: "morning-card",
    stack: "nextjs",
    title: "朝の1枚",
    pitch: "天気と今日の予定を、起きてすぐ1枚のカードで見られるページ",
    who: "朝の支度をしながらスマホを見る人",
    novel: "天気に合わせて、出かける時刻の目安を出す",
    paid: "",
    screen: "大きなカード1枚と、下に時間ごとの予定",
  },
  {
    name: "plan-box",
    stack: "saas",
    title: "予定箱",
    pitch: "家族の予定をまとめて、朝に1回だけ知らせる",
    who: "家族の予定を管理する人",
    novel: "知らせは朝の1回だけ",
    paid: "家族を4人以上にする・通知の時刻を選ぶ",
    screen: "家族ごとの列と、今日の予定",
  },
  {
    name: "weather-walk",
    stack: "nextjs",
    title: "散歩びより",
    pitch: "今日いちばん散歩に向いている時間を教える",
    who: "犬の散歩をする人",
    novel: "気温と雨と日差しから、30分ごとに点数を付ける",
    paid: "",
    screen: "1日の帯グラフと、いちばん良い時間",
  },
];

const LOOKS = [
  { n: 1, title: "夜明け", idea: "暗い青の地に、日の出の黄色を少しだけ", colors: ["#1D2433", "#F2C46B", "#9AA3B5", "#EFE9DC"], fonts: "明朝の見出し＋ゴシックの本文" },
  { n: 2, title: "新聞", idea: "白い紙に黒の文字、罫線で区切る", colors: ["#FFFFFF", "#1A1A1A", "#6B6B6B", "#C8402F"], fonts: "太い明朝" },
  { n: 3, title: "まるい", idea: "深い緑に、丸い形と明るい差し色", colors: ["#164036", "#7BE0B6", "#FFB35C", "#F6F3EA"], fonts: "丸ゴシック" },
];

const MOCKS = [
  { key: "a", title: "写真を大きく", note: "上半分に今日の空、下に予定のカード" },
  { key: "b", title: "文字を大きく", note: "大きな数字で気温と時刻、写真は使わない" },
];

const CONFIRM = {
  name: "morning-card",
  stack: "nextjs",
  description: "天気と今日の予定を、起きてすぐ1枚で見られるページ",
  free: [],
  paid: [],
  price: null,
  pages: ["トップ（今日の1枚）", "予定の追加"],
};

const QUESTIONS: Record<FactoryStage, { q: string; options: string[]; recommend: number }[]> = {
  ideas: [{ q: "主に使う端末は？", options: ["スマホが中心", "PCが中心", "両方"], recommend: 0 }],
  looks: [{ q: "画面の明るさは？", options: ["暗め", "明るめ"], recommend: 0 }],
  mocks: [],
  confirm: [],
};

const NEXT: Record<FactoryStage, FactoryStage | null> = { ideas: "looks", looks: "mocks", mocks: "confirm", confirm: null };

/** 段階の物と質問を入れた state（前の state の選んだ物・決まった事は残す） */
export function demoFactoryState(stage: FactoryStage, base: State = {}): State {
  const round = (typeof base.round === "number" ? base.round : 0) + 1;
  const state: State = {
    ...base,
    v: 1,
    stage,
    round,
    assets: { ...(typeof base.assets === "object" && base.assets !== null ? base.assets : {}), [stage]: `issue-19/r${round}-${stage}` },
    ask: { questions: QUESTIONS[stage] },
  };
  if (stage === "ideas") state.ideas = IDEAS;
  if (stage === "looks") state.looks = LOOKS;
  if (stage === "mocks") state.mocks = MOCKS;
  if (stage === "confirm") state.confirm = CONFIRM;
  return state;
}

/** 段階ごとの画像（工場のコメントと同じ alt） */
function images(state: State): string[] {
  switch (state.stage) {
    case "looks":
      return LOOKS.map((l) => `<img src="/factory/look-${l.n}.svg" width="720" alt="方向${l.n}">`);
    case "mocks":
      return MOCKS.map(
        (m) =>
          `<img src="/mockups/${m.key}-pc.svg" alt="${m.key.toUpperCase()} PC"> <img src="/mockups/${m.key}-mobile.svg" alt="${m.key.toUpperCase()} スマホ">`,
      );
    case "confirm": {
      const k = state.mock === "b" ? "b" : "a";
      return [`<img src="/mockups/${k}-pc.svg" alt="選んだ画面"> <img src="/mockups/${k}-mobile.svg" alt="選んだ画面 スマホ">`];
    }
    default:
      return [];
  }
}

const HEADINGS: Record<FactoryStage, string> = {
  ideas: "## 🧭 作る物の案を考えました",
  looks: "## 🎨 「朝の1枚」の見た目の方向を3つ作りました",
  mocks: "## 🖼 ざっくり画面を2案作りました（左が PC、右がスマホ）",
  confirm: "## ✅ これで作り始めます（最終確認）",
};

/** 工場の相談のコメントの本文（見出し・画像・印） */
export function demoFactoryBody(state: State): string {
  const stage = state.stage as FactoryStage;
  return [HEADINGS[stage], "", ...images(state), "", encodeFactoryMark(state)].join("\n");
}

/**
 * デモで答えを送ったあと、工場がすること。戻り値：足すコメント（工場の物）と、`factory:wait` を外すか・Issueを閉じるか
 */
export function demoFactoryReply(
  currentBody: string | null,
  answer: string,
): { body: string | null; keepWaiting: boolean; close: boolean } {
  const reply = parseFactoryAnswer(answer);
  const state = currentBody ? decodeFactoryMark(currentBody) : null;
  const stage = typeof state?.stage === "string" ? (state.stage as FactoryStage) : null;
  if (!state || !stage || !(stage in NEXT) || reply === null || reply === "invalid") {
    // 印が読めない答え：工場がAIで読む間（デモでは、待ちを外すだけ）
    return { body: null, keepWaiting: false, close: false };
  }
  const answers = [
    ...(Array.isArray(state.answers) ? state.answers : []),
    ...reply.answers,
  ];
  const base = { ...state, answers };
  if (reply.action === "redo") return { body: demoFactoryBody(demoFactoryState(stage, base)), keepWaiting: true, close: false };
  if (reply.action === "go") {
    if (stage !== "confirm") return { body: null, keepWaiting: false, close: false };
    return {
      body: `🏭 **morning-card** を作り始めます。できたらこの Issue に結果を書きます（1時間くらい）。\n\n${encodeFactoryMark({ ...base, stage: "go" })}`,
      keepWaiting: false,
      close: true,
    };
  }
  const next = NEXT[stage];
  if (!next) return { body: null, keepWaiting: false, close: false };
  const picked =
    stage === "ideas" ? { idea: Number(reply.choice) - 1 } : stage === "looks" ? { look: Number(reply.choice) } : { mock: reply.choice };
  return { body: demoFactoryBody(demoFactoryState(next, { ...base, ...picked })), keepWaiting: true, close: false };
}
