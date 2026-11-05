import type { CommentData } from "./github/types";

/**
 * 企画AIの質問（`ai:question`）のコメントを読む・答えの文を組み立てる純粋関数（docs/spec.md の「企画AIの質問」）。
 *
 * 質問のコメント：1行目が質問の印（`<!-- ai-question -->`）。`**Q1. …**` の行が質問、その下の
 * `- A. …（おすすめ）` の行が選択肢。同じコメントに画面案の印（`<!-- mockups -->`）があれば、
 * その後ろの `<img src>` を画面案（A・B。PC とスマホ）として読む
 */

/** 質問のコメントの1行目の印。`<!-- ai-question -->`（`ai:question`・`question` も同じ扱い） */
const QUESTION_MARK_PATTERN = /^<!--\s*(?:ai[-:_]?)?question\s*-->/i;
/** 画面案の印。`<!-- mockups -->`（`mockup`・`ai-mockups` も同じ扱い） */
const MOCKUP_MARK_PATTERN = /<!--\s*(?:ai[-:_]?)?mockups?\s*-->/i;
/** `**Q1. 質問**`（`**Q1.** 質問` も可） */
const QUESTION_LINE_PATTERN = /^\s*\*\*\s*Q(\d+)\s*[.．:：]?\s*(.*?)\*\*\s*(.*)$/;
/** `- A. 選択肢`（`*`・`A)`・`A：` も可） */
const OPTION_LINE_PATTERN = /^\s*[-*]\s*([A-Z])\s*[.．:：)）]\s*(.+?)\s*$/;
const RECOMMENDED_PATTERN = /\s*[（(]\s*おすすめ\s*[）)]\s*/;
/** 画面案の見出しの行（`### A. 明るい`・`**A. 明るい**`・`A案：…`・`- A …`） */
const MOCKUP_HEADING_PATTERN = /^\s*(?:#{1,6}\s*|[-*]\s*)?(?:\*\*)?\s*(?:案\s*)?([AB])(?:案)?(?:\s*[.．:：)）]|\s|\*\*|$)\s*(.*?)\s*(?:\*\*)?\s*$/;
const IMG_PATTERN = /<img\b[^>]*>/gi;
const SRC_PATTERN = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;
const ALT_PATTERN = /\balt\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;
const MOBILE_PATTERN = /スマホ|モバイル|mobile|phone|\bsp\b/i;
/** 答えの文の長さの上限（サーバーでも確かめる） */
export const MAX_ANSWER_LENGTH = 4000;

export type QuestionOption = {
  /** `A`・`B`… */
  letter: string;
  text: string;
  recommended: boolean;
};

export type QuestionItem = {
  /** `Q1` の 1 */
  number: number;
  text: string;
  options: QuestionOption[];
};

export type MockupImage = {
  src: string;
  alt: string;
  device: "pc" | "mobile";
};

export type MockupOption = {
  /** `A` か `B` */
  letter: "A" | "B";
  /** 見出しの文字（無ければ空） */
  label: string;
  images: MockupImage[];
};

export type ParsedQuestion = {
  /** 質問のコメントの id と時刻 */
  commentId: number;
  createdAt: string;
  questions: QuestionItem[];
  /** 画面案（無ければ空） */
  mockups: MockupOption[];
};

/** 質問のコメントか（1行目が質問の印） */
export function isQuestionComment(comment: Pick<CommentData, "body">): boolean {
  return QUESTION_MARK_PATTERN.test(comment.body.trimStart());
}

/** そのIssueのいちばん新しい質問のコメント（無ければ null） */
export function latestQuestionComment(comments: CommentData[], issueNumber: number): CommentData | null {
  return (
    comments
      .filter((comment) => comment.issueNumber === issueNumber && isQuestionComment(comment))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .at(-1) ?? null
  );
}

/** 人が書いたコメントか（作者が `…[bot]` でない） */
function isHumanComment(comment: CommentData): boolean {
  return !comment.author.endsWith("[bot]");
}

/**
 * いちばん新しい質問のあとに、人がコメントで答えたか。
 * 質問のコメントが無いときは false（答えを待っている）
 */
export function isQuestionAnswered(comments: CommentData[], issueNumber: number): boolean {
  const question = latestQuestionComment(comments, issueNumber);
  if (!question) return false;
  return comments.some(
    (comment) =>
      comment.issueNumber === issueNumber &&
      isHumanComment(comment) &&
      comment.createdAt > question.createdAt,
  );
}

function attr(tag: string, pattern: RegExp): string {
  const match = pattern.exec(tag);
  return (match?.[1] ?? match?.[2] ?? match?.[3] ?? "").trim();
}

/** 画像のURLとして使ってよいか（`https://` と、同じサイトの `/` で始まるパス（デモ）だけ） */
export function isSafeImageUrl(src: string): boolean {
  if (/^\/(?![/\\])/.test(src)) return true;
  try {
    return new URL(src).protocol === "https:";
  } catch {
    return false;
  }
}

/** 質問の本文から `**Q1. …**` と、その下の選択肢を読む */
export function parseQuestions(body: string): QuestionItem[] {
  const questions: QuestionItem[] = [];
  let current: QuestionItem | null = null;
  for (const line of body.split(/\r?\n/)) {
    const q = QUESTION_LINE_PATTERN.exec(line);
    if (q) {
      const text = `${q[2]} ${q[3]}`.trim().replace(/\s+/g, " ");
      current = { number: Number(q[1]), text, options: [] };
      questions.push(current);
      continue;
    }
    if (!current) continue;
    const option = OPTION_LINE_PATTERN.exec(line);
    if (option) {
      const recommended = RECOMMENDED_PATTERN.test(option[2]);
      const text = option[2].replace(RECOMMENDED_PATTERN, "").trim();
      current.options.push({ letter: option[1], text, recommended });
    } else if (/^\s*#{1,6}\s/.test(line) || MOCKUP_MARK_PATTERN.test(line)) {
      // 見出しや画面案の印が来たら、その質問は終わり
      current = null;
    }
  }
  return questions;
}

/** 画面案の印より後ろの `<img src>` を、A・B に分けて読む（印が無ければ空） */
export function parseMockups(body: string): MockupOption[] {
  const mark = MOCKUP_MARK_PATTERN.exec(body);
  if (!mark) return [];
  const rest = body.slice(mark.index + mark[0].length);
  const found: { letter: "A" | "B" | null; label: string; image: MockupImage }[] = [];
  const labels: Record<"A" | "B", string> = { A: "", B: "" };
  let letter: "A" | "B" | null = null;
  for (const line of rest.split(/\r?\n/)) {
    const withoutImages = line.replace(IMG_PATTERN, "").trim();
    const heading = withoutImages === "" ? null : MOCKUP_HEADING_PATTERN.exec(withoutImages);
    if (heading) {
      letter = heading[1] as "A" | "B";
      const label = heading[2].replace(/\*\*/g, "").trim();
      if (label !== "" && labels[letter] === "") labels[letter] = label;
    }
    for (const tag of line.match(IMG_PATTERN) ?? []) {
      const src = attr(tag, SRC_PATTERN);
      if (!isSafeImageUrl(src)) continue;
      const alt = attr(tag, ALT_PATTERN);
      const device = MOBILE_PATTERN.test(`${alt} ${withoutImages}`) ? "mobile" : "pc";
      found.push({ letter, label: "", image: { src, alt, device } });
    }
  }
  if (found.length === 0) return [];
  // 見出しが無い画像は、前半を A、後半を B にする
  const half = Math.ceil(found.length / 2);
  const options: MockupOption[] = (["A", "B"] as const).map((l) => ({ letter: l, label: labels[l], images: [] }));
  found.forEach((item, i) => {
    const target = item.letter ?? (i < half ? "A" : "B");
    options[target === "A" ? 0 : 1].images.push(item.image);
  });
  return options.filter((option) => option.images.length > 0);
}

/** そのIssueのいちばん新しい質問のコメントを読む（無ければ null） */
export function parseQuestionComment(comments: CommentData[], issueNumber: number): ParsedQuestion | null {
  const comment = latestQuestionComment(comments, issueNumber);
  if (!comment) return null;
  return {
    commentId: comment.id,
    createdAt: comment.createdAt,
    questions: parseQuestions(comment.body),
    mockups: parseMockups(comment.body),
  };
}

/** 画面で選んだ・書いた答え */
export type AnswerInput = {
  /** 画面案で選んだ物（`A`・`B`。選んでいなければ null） */
  mockup: string | null;
  /** 質問ごとの答え（キーは質問の番号） */
  answers: Record<number, { choice: string | null; note: string }>;
  /** ほかに伝えたいこと */
  note: string;
};

function trimPeriod(text: string): string {
  return text.trim().replace(/[。.]+$/, "");
}

/**
 * Issueに送る答えの文（人が読める文）。例：`A。Q1はB（明るい）。Q2：もう少し青く`。
 * 何も選んでいない・書いていなければ空文字
 */
export function composeAnswer(question: Pick<ParsedQuestion, "questions" | "mockups">, input: AnswerInput): string {
  const parts: string[] = [];
  const mockup = question.mockups.find((m) => m.letter === input.mockup);
  if (mockup) parts.push(mockup.letter);
  for (const item of question.questions) {
    const answer = input.answers[item.number];
    if (!answer) continue;
    const option = item.options.find((o) => o.letter === answer.choice);
    const note = trimPeriod(answer.note);
    if (option) {
      const head = `Q${item.number}は${option.letter}（${option.text}）`;
      parts.push(note === "" ? head : `${head}：${note}`);
    } else if (note !== "") {
      parts.push(`Q${item.number}：${note}`);
    }
  }
  const line = parts.join("。");
  const extra = input.note.trim();
  if (line === "") return extra;
  return extra === "" ? line : `${line}\n\n${extra}`;
}

/** 送る答えの文として受け付けるか（空でなく、長すぎない） */
export function isValidAnswer(text: unknown): text is string {
  return typeof text === "string" && text.trim() !== "" && text.length <= MAX_ANSWER_LENGTH;
}
