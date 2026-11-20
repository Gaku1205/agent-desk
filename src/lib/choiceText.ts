import type { AnswerInput, ParsedQuestion } from "./question";

/** 文の一切れ。`code` は `` `AI` `` のようにバッククォートで囲まれていた所（バッククォートは外す） */
export type TextPart = { text: string; code: boolean };

/** 選択肢の文を分けた物：見出し（太め）・その下の1行の説明・おすすめか */
export type ChoiceText = { head: string; body: string; recommended: boolean };

const RECOMMENDED = /\s*[（(]\s*おすすめ\s*[）)]\s*/g;

/**
 * 企画AIの選択肢の文を、見出しと説明に分ける（docs/design.md の「ホーム（決める画面）」）。
 * 最初の「。」まで（無ければ「（」の前まで）を見出し、残りを説明にする。分けられなければ全文を見出しにする。
 * `（おすすめ）` は文から外して recommended にする。説明が全部（…）で囲まれていれば、外の括弧を外す
 */
export function splitChoice(text: string): ChoiceText {
  const recommended = RECOMMENDED.test(text);
  RECOMMENDED.lastIndex = 0;
  const clean = text.replace(RECOMMENDED, " ").replace(/\s+/g, " ").trim();
  const dot = clean.indexOf("。");
  if (dot > 0) {
    const head = clean.slice(0, dot).trim();
    const body = unwrap(clean.slice(dot + 1).trim());
    return { head, body, recommended };
  }
  const paren = clean.search(/[（(]/);
  if (paren > 0) {
    const head = clean.slice(0, paren).trim();
    const body = unwrap(clean.slice(paren).trim());
    if (head !== "" && body !== "") return { head, body, recommended };
  }
  return { head: clean, body: "", recommended };
}

/** 全体が（…）で囲まれた説明の、外の括弧を外す */
function unwrap(body: string): string {
  const match = /^[（(](.*)[）)]$/.exec(body);
  if (!match || /[（()）]/.test(match[1])) return body;
  return match[1].trim();
}

/** 文の中の `` `…` `` を、コードの見た目にする一切れに分ける（閉じていないバッククォートはそのまま文字） */
export function codeParts(text: string): TextPart[] {
  const parts: TextPart[] = [];
  const pattern = /`([^`]+)`/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const at = match.index ?? 0;
    if (at > last) parts.push({ text: text.slice(last, at), code: false });
    parts.push({ text: match[1], code: true });
    last = at + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), code: false });
  return parts;
}

/** おすすめの選択肢を最初から選んだ答え（おすすめの無い質問は選ばないまま） */
export function presetAnswer(question: ParsedQuestion | null): AnswerInput {
  const answers: AnswerInput["answers"] = {};
  for (const item of question?.questions ?? []) {
    const rec = item.options.find((option) => option.recommended);
    if (rec) answers[item.number] = { choice: rec.letter, note: "" };
  }
  return { mockup: null, answers, note: "" };
}
