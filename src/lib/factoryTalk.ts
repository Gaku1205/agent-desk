import type { CommentData } from "./github/types";
import { isSafeImageUrl, type QuestionItem } from "./question";

/**
 * 工場の相談（`factory:wait`）のコメントを読む・答えを組み立てる純粋関数（docs/spec.md の「工場の相談」）。
 *
 * 工場（`github-actions[bot]`）のコメントの印 `<!-- factory-talk:v1:BASE64 -->` の中身は、工場の state（UTF-8 の JSON。
 * 形は ai-dev-template の `.github/scripts/factory-talk.py`）。答えは、人が読める文の下に
 * 印 `<!-- factory-answer:BASE64 -->`（`{"action","choice","answers","note"}`）を付けて送る
 */

/** 工場のコメントを書く人 */
export const FACTORY_BOT = "github-actions[bot]";
const TALK_MARK_PATTERN = /<!-- factory-talk:v1:([A-Za-z0-9+/=]+) -->/;
const ANSWER_MARK_PATTERN = /<!-- factory-answer:([A-Za-z0-9+/=]+) -->/;
const IMG_PATTERN = /<img\b[^>]*>/gi;
const SRC_PATTERN = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;
const ALT_PATTERN = /\balt\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;
/** 画像の置き場（factory-talk ブランチの中のパス）として使ってよい形 */
const SAFE_ASSET_PATH = /^[\w./-]+$/;
/** 工場が切る長さ（factory-talk.py の apply） */
export const MAX_FACTORY_NOTE = 400;
export const MAX_FACTORY_ANSWER = 200;

export type FactoryStage = "ideas" | "looks" | "mocks" | "confirm";
export const FACTORY_STAGES: readonly FactoryStage[] = ["ideas", "looks", "mocks", "confirm"];

export type FactoryImage = { src: string; alt: string; device: "pc" | "mobile" };

/** 1つの選択肢（案・見た目の方向・画面） */
export type FactoryChoice = {
  /** 答えの `choice` に入れる値（案 `"2"`・方向 `"1"`・画面 `"a"`） */
  value: string;
  /** 見出しの番号か文字（`2`・`A`） */
  mark: string;
  title: string;
  /** 題名の下の小さな補足（案の `name・stack`） */
  sub: string;
  /** 紹介の文 */
  text: string;
  /** 名前と中身の行（案の 使う人・新しい所・有料・画面） */
  facts: { label: string; value: string }[];
  /** 色の見本（見た目の方向） */
  colors: string[];
  /** 文字の指定（見た目の方向） */
  fonts: string;
  images: FactoryImage[];
};

/** 最終確認のまとめ */
export type FactoryConfirm = {
  facts: { label: string; value: string }[];
  images: FactoryImage[];
};

export type FactoryTalk = {
  /** 工場の相談のコメントの id と時刻 */
  commentId: number;
  createdAt: string;
  /** 今の段階（読めなければ null：「答えを書く」の欄だけ出す） */
  stage: FactoryStage | null;
  /** 工場からのお知らせ（作れなかった・読み取れなかったときの1行目。無ければ空） */
  notice: string;
  choices: FactoryChoice[];
  confirm: FactoryConfirm | null;
  /** 質問（`QuestionForm` の部品で出す形。選択肢の文字は A・B…） */
  questions: QuestionItem[];
};

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function strings(value: unknown): string[] {
  return list(value).map(str).filter((s) => s !== "");
}

/** UTF-8 の文字列を BASE64 にする（ブラウザとサーバーの両方で動く） */
export function encodeBase64(text: string): string {
  let binary = "";
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** BASE64 を UTF-8 の文字列に戻す（読めなければ null） */
export function decodeBase64(base64: string): string | null {
  try {
    const binary = atob(base64);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function decodeJsonMark(body: string, pattern: RegExp): Json | null {
  const match = pattern.exec(body);
  if (!match) return null;
  const text = decodeBase64(match[1]);
  if (text === null) return null;
  try {
    const value: unknown = JSON.parse(text);
    return isObject(value) ? value : null;
  } catch {
    return null;
  }
}

/** 工場の state を印にする（デモ・テスト用。工場の `encode` と同じ形） */
export function encodeFactoryMark(state: Json): string {
  return `<!-- factory-talk:v1:${encodeBase64(JSON.stringify(state))} -->`;
}

/** コメントの印から工場の state を読む（無い・読めなければ null） */
export function decodeFactoryMark(body: string): Json | null {
  return decodeJsonMark(body, TALK_MARK_PATTERN);
}

/** 工場の相談のコメントか（作者が工場で、印が読める） */
export function isFactoryTalkComment(comment: Pick<CommentData, "author" | "body">): boolean {
  return comment.author === FACTORY_BOT && decodeFactoryMark(comment.body) !== null;
}

/** そのIssueのいちばん新しい工場の相談のコメント（無ければ null） */
export function latestFactoryComment(comments: CommentData[], issueNumber: number): CommentData | null {
  return (
    comments
      .filter((comment) => comment.issueNumber === issueNumber && isFactoryTalkComment(comment))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .at(-1) ?? null
  );
}

/**
 * いちばん新しい工場の相談のあとに、人がコメントで答えたか。
 * 工場の相談のコメントが無いときは false（答えを待っている）
 */
export function isFactoryAnswered(comments: CommentData[], issueNumber: number): boolean {
  const talk = latestFactoryComment(comments, issueNumber);
  if (!talk) return false;
  return comments.some(
    (comment) =>
      comment.issueNumber === issueNumber &&
      !comment.author.endsWith("[bot]") &&
      comment.createdAt > talk.createdAt,
  );
}

function attr(tag: string, pattern: RegExp): string {
  const match = pattern.exec(tag);
  return (match?.[1] ?? match?.[2] ?? match?.[3] ?? "").trim();
}

/** コメントの `<img>` を、`alt` から `src` を引けるようにする（使ってよいURLだけ） */
function commentImages(body: string): Map<string, string> {
  const images = new Map<string, string>();
  for (const tag of body.match(IMG_PATTERN) ?? []) {
    const alt = attr(tag, ALT_PATTERN);
    const src = attr(tag, SRC_PATTERN);
    if (alt !== "" && isSafeImageUrl(src) && !images.has(alt)) images.set(alt, src);
  }
  return images;
}

/**
 * 1枚の画像のURL：コメントの `<img>` の `alt` が合う物、無ければ `assets` から作る。どちらも無ければ null
 */
function imageUrl(
  images: Map<string, string>,
  alt: string,
  assetPath: string,
  file: string,
  repo: string,
): string | null {
  const fromComment = images.get(alt);
  if (fromComment) return fromComment;
  if (assetPath === "" || !SAFE_ASSET_PATH.test(assetPath) || assetPath.includes("..")) return null;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return null;
  return `https://raw.githubusercontent.com/${repo}/factory-talk/${assetPath.replace(/^\/+|\/+$/g, "")}/${file}`;
}

function image(
  images: Map<string, string>,
  alt: string,
  assetPath: string,
  file: string,
  repo: string,
  device: "pc" | "mobile",
): FactoryImage[] {
  const src = imageUrl(images, alt, assetPath, file, repo);
  return src === null ? [] : [{ src, alt, device }];
}

function emptyChoice(value: string, mark: string, title: string): FactoryChoice {
  return { value, mark, title, sub: "", text: "", facts: [], colors: [], fonts: "", images: [] };
}

const IDEA_FACTS: [string, string][] = [
  ["使う人", "who"],
  ["新しい所", "novel"],
  ["有料", "paid"],
  ["画面", "screen"],
];

function ideaChoices(state: Json): FactoryChoice[] {
  return list(state.ideas).flatMap((raw, i) => {
    if (!isObject(raw)) return [];
    const n = String(i + 1);
    const name = str(raw.name);
    const stack = str(raw.stack);
    return [
      {
        ...emptyChoice(n, n, str(raw.title) || name || `案${n}`),
        sub: [name, stack].filter((s) => s !== "").join("・"),
        text: str(raw.pitch),
        facts: IDEA_FACTS.map(([label, key]) => ({ label, value: str(raw[key]) })).filter((f) => f.value !== ""),
      },
    ];
  });
}

function lookChoices(state: Json, images: Map<string, string>, assets: Json, repo: string): FactoryChoice[] {
  return list(state.looks).flatMap((raw) => {
    if (!isObject(raw) || typeof raw.n !== "number" || !Number.isSafeInteger(raw.n)) return [];
    const n = String(raw.n);
    return [
      {
        ...emptyChoice(n, n, str(raw.title) || `方向${n}`),
        text: str(raw.idea),
        colors: strings(raw.colors).filter((c) => /^#[0-9A-Fa-f]{6}$/.test(c)),
        fonts: str(raw.fonts),
        images: image(images, `方向${n}`, str(assets.looks), `look-${n}-1440.png`, repo, "pc"),
      },
    ];
  });
}

function mockImages(images: Map<string, string>, assets: Json, key: string, repo: string, alt: [string, string]) {
  const path = str(assets.mocks);
  return [
    ...image(images, alt[0], path, `mock-${key}-1440.png`, repo, "pc"),
    ...image(images, alt[1], path, `mock-${key}-390.png`, repo, "mobile"),
  ];
}

function mockChoices(state: Json, images: Map<string, string>, assets: Json, repo: string): FactoryChoice[] {
  return list(state.mocks).flatMap((raw) => {
    if (!isObject(raw)) return [];
    const key = str(raw.key).toLowerCase();
    if (key !== "a" && key !== "b") return [];
    const letter = key.toUpperCase();
    return [
      {
        ...emptyChoice(key, letter, str(raw.title) || letter),
        text: str(raw.note),
        images: mockImages(images, assets, key, repo, [`${letter} PC`, `${letter} スマホ`]),
      },
    ];
  });
}

function confirmSummary(state: Json, images: Map<string, string>, assets: Json, repo: string): FactoryConfirm | null {
  const c = state.confirm;
  if (!isObject(c)) return null;
  const facts: { label: string; value: string }[] = [];
  const add = (label: string, value: string) => {
    if (value !== "") facts.push({ label, value });
  };
  const stack = str(c.stack);
  add("名前", str(c.name) === "" ? "" : `${str(c.name)}${stack ? `（${stack}）` : ""}`);
  add("何のサービス", str(c.description));
  if (stack === "saas") {
    add("無料", strings(c.free).join("・"));
    const price = typeof c.price === "number" ? `有料（月 ${c.price} 円）` : "有料";
    add(price, strings(c.paid).join("・"));
  }
  add("最初に作る画面", strings(c.pages).join("・"));
  const answers = list(state.answers)
    .filter(isObject)
    .map((a) => (str(a.q) && str(a.a) ? `${str(a.q)} → ${str(a.a)}` : ""))
    .filter((s) => s !== "");
  add("決まった事", answers.join("／"));
  const mock = str(state.mock).toLowerCase();
  const shots = mock === "a" || mock === "b" ? mockImages(images, assets, mock, repo, ["選んだ画面", "選んだ画面 スマホ"]) : [];
  return { facts, images: shots };
}

function factoryQuestions(state: Json): QuestionItem[] {
  const ask = isObject(state.ask) ? state.ask : {};
  return list(ask.questions).flatMap((raw) => {
    if (!isObject(raw)) return [];
    const text = str(raw.q);
    const options = strings(raw.options);
    if (text === "" || options.length === 0) return [];
    const recommend = typeof raw.recommend === "number" ? raw.recommend : -1;
    return [
      {
        number: 0,
        text,
        options: options.map((option, i) => ({
          letter: String.fromCharCode(65 + i),
          text: option,
          recommended: i === recommend,
        })),
      },
    ];
  }).map((item, i) => ({ ...item, number: i + 1 }));
}

/** 作れなかった・読み取れなかったときのコメントの1行目（`🤔`・`⚠️` で始まる物）。無ければ空 */
function noticeOf(body: string): string {
  const first = body.trimStart().split(/\r?\n/)[0] ?? "";
  if (!/^(🤔|⚠️|⚠)/u.test(first)) return "";
  return first
    .replace(TALK_MARK_PATTERN, "")
    .replace(/^(🤔|⚠️|⚠)\s*/u, "")
    .replace(/\*\*/g, "")
    .trim();
}

/** そのIssueのいちばん新しい工場の相談を読む（無ければ null）。repo は `owner/repo`（画像のURLを作る） */
export function parseFactoryTalk(comments: CommentData[], issueNumber: number, repo: string): FactoryTalk | null {
  const comment = latestFactoryComment(comments, issueNumber);
  if (!comment) return null;
  const state = decodeFactoryMark(comment.body) ?? {};
  const rawStage = str(state.stage);
  const stage = (FACTORY_STAGES as readonly string[]).includes(rawStage) ? (rawStage as FactoryStage) : null;
  const images = commentImages(comment.body);
  const assets = isObject(state.assets) ? state.assets : {};
  const choices =
    stage === "ideas"
      ? ideaChoices(state)
      : stage === "looks"
        ? lookChoices(state, images, assets, repo)
        : stage === "mocks"
          ? mockChoices(state, images, assets, repo)
          : [];
  const confirm = stage === "confirm" ? confirmSummary(state, images, assets, repo) : null;
  // 選択肢が読めない段階は、選ばせずに「答えを書く」だけにする
  const readable = stage === "confirm" ? confirm !== null : choices.length > 0;
  return {
    commentId: comment.id,
    createdAt: comment.createdAt,
    stage: readable ? stage : null,
    notice: noticeOf(comment.body),
    choices: readable ? choices : [],
    confirm: readable ? confirm : null,
    questions: readable ? factoryQuestions(state) : [],
  };
}

/** 選択肢の値の特別な物：全部ちがう（出し直し）・作る・直す */
export const FACTORY_REDO = "redo";
export const FACTORY_GO = "go";
export const FACTORY_FIX = "fix";

/** 画面で選んだ・書いた物 */
export type FactoryInput = {
  /** 選んだ選択肢の値（`"2"`・`"a"`）か、`redo`（全部ちがう）・`go`（作る）・`fix`（直す）。選んでいなければ null */
  pick: string | null;
  /** 全部ちがう・直すのときの、どう変えてほしいか */
  redoNote: string;
  /** 質問ごとの答え（キーは質問の番号） */
  answers: Record<number, { choice: string | null; note: string }>;
  /** ほかに伝えたいこと */
  note: string;
};

export type FactoryReply = {
  action: "pick" | "redo" | "go";
  choice: string | null;
  answers: { q: string; a: string }[];
  note: string;
};

function trimPeriod(text: string): string {
  return text.trim().replace(/[。.]+$/, "");
}

function cut(text: string, limit: number): string {
  return Array.from(text).slice(0, limit).join("");
}

function pickHead(stage: FactoryStage, choice: FactoryChoice): string {
  switch (stage) {
    case "ideas":
      return `案${choice.mark}を選ぶ`;
    case "looks":
      return `見た目の方向${choice.mark}を選ぶ`;
    default:
      return `画面${choice.mark}を選ぶ`;
  }
}

/**
 * 工場へ送る返事（印の中身）と、人が読める文の頭。選んでいない・書くべき所が空なら null
 */
export function factoryReply(
  talk: Pick<FactoryTalk, "stage" | "choices" | "questions">,
  input: FactoryInput,
): { head: string; reply: FactoryReply } | null {
  const stage = talk.stage;
  if (stage === null || input.pick === null) return null;
  const redoNote = cut(trimPeriod(input.redoNote), MAX_FACTORY_NOTE);
  const extra = cut(input.note.trim(), MAX_FACTORY_NOTE);
  let head: string;
  let action: FactoryReply["action"];
  let choice: string | null = null;
  let note = extra;
  if (input.pick === FACTORY_REDO || input.pick === FACTORY_FIX) {
    // 全部ちがう（案・方向・画面）・直す（最終確認）：書いた文が注文
    if ((input.pick === FACTORY_FIX) !== (stage === "confirm")) return null;
    if (redoNote === "") return null;
    action = "redo";
    head = `${input.pick === FACTORY_FIX ? "直す" : "全部ちがう"}：${redoNote}`;
    note = redoNote;
  } else if (input.pick === FACTORY_GO) {
    if (stage !== "confirm") return null;
    action = "go";
    head = "作る";
  } else {
    const picked = stage === "confirm" ? undefined : talk.choices.find((c) => c.value === input.pick);
    if (!picked) return null;
    action = "pick";
    choice = picked.value;
    head = pickHead(stage, picked);
  }
  const answers: { q: string; a: string }[] = [];
  for (const item of talk.questions) {
    const answer = input.answers[item.number];
    if (!answer) continue;
    const option = item.options.find((o) => o.letter === answer.choice);
    const written = trimPeriod(answer.note);
    const a = option ? (written === "" ? option.text : `${option.text}：${written}`) : written;
    if (a !== "") answers.push({ q: item.text, a: cut(a, MAX_FACTORY_ANSWER) });
  }
  return { head, reply: { action, choice, answers, note } };
}

/** 人が読める文（送る文の見本。印は入れない）。送れないときは空文字 */
export function factoryAnswerText(talk: Pick<FactoryTalk, "stage" | "choices" | "questions">, input: FactoryInput): string {
  if (talk.stage === null) return input.note.trim();
  const built = factoryReply(talk, input);
  if (!built) return "";
  const qs = talk.questions.flatMap((item) => {
    const found = built.reply.answers.find((a) => a.q === item.text);
    return found ? [`Q${item.number}：${found.a}`] : [];
  });
  const line = [built.head, ...qs].join("。");
  const extra = built.reply.action === "redo" ? "" : built.reply.note;
  return extra === "" ? line : `${line}\n\n${extra}`;
}

/**
 * Issueに送るコメント：人が読める文の下（空行のあと）に、印 `<!-- factory-answer:BASE64 -->`。
 * 段階が読めないときは、書いた文だけ（印なし）。送れないときは空文字
 */
export function composeFactoryAnswer(
  talk: Pick<FactoryTalk, "stage" | "choices" | "questions">,
  input: FactoryInput,
): string {
  const text = factoryAnswerText(talk, input);
  if (text === "") return "";
  const built = factoryReply(talk, input);
  if (!built) return text;
  return `${text}\n\n<!-- factory-answer:${encodeBase64(JSON.stringify(built.reply))} -->`;
}

/**
 * コメントの印 `<!-- factory-answer:… -->` を読む。印が無ければ null、印があって読めない・形が違うときは "invalid"
 */
export function parseFactoryAnswer(body: string): FactoryReply | "invalid" | null {
  if (!ANSWER_MARK_PATTERN.test(body)) return null;
  const value = decodeJsonMark(body, ANSWER_MARK_PATTERN);
  if (!value) return "invalid";
  const action = value.action;
  if (action !== "pick" && action !== "redo" && action !== "go") return "invalid";
  const choice = typeof value.choice === "string" ? value.choice : null;
  const answers = list(value.answers)
    .filter(isObject)
    .map((a) => ({ q: str(a.q), a: str(a.a) }))
    .filter((a) => a.q !== "" && a.a !== "");
  return { action, choice, answers, note: str(value.note) };
}

/** 空の入力 */
export function emptyFactoryInput(): FactoryInput {
  return { pick: null, redoNote: "", answers: {}, note: "" };
}
