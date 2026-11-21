import { splitChoice } from "./choiceText";
import type { AnswerInput, ParsedQuestion, QuestionItem, QuestionOption } from "./question";

/**
 * 質問を「おすすめで全部答える」ための純粋関数（docs/spec.md の「ホーム（決める画面）」の質問の選択肢）。
 * 問いの短い名前・`Q1はB、Q2はB、Q3はA` の文・押したあとの中身の1行を作る
 */

/** 問いの短い名前の長さの上限 */
export const SHORT_NAME_MAX = 20;

/** 問いの文の頭の「〜は」「〜を」の前まで（20字まで）。取れなければ空文字（呼ぶ側は `Q1` だけにする） */
export function shortQuestionName(text: string): string {
  const clean = text.trim();
  const at = clean.search(/[はを]/);
  if (at <= 0) return "";
  const name = clean.slice(0, at).trim();
  return name === "" || [...name].length > SHORT_NAME_MAX ? "" : name;
}

/** 問いの切り替えの1つ分の文字：`Q1 数える時間`（取れなければ `Q1`） */
export function questionTabLabel(item: Pick<QuestionItem, "number" | "text">): string {
  const name = shortQuestionName(item.text);
  return name === "" ? `Q${item.number}` : `Q${item.number} ${name}`;
}

type Chosen = { item: QuestionItem; option: QuestionOption };

/**
 * 全部の問いの答え（選んでいる物を優先し、選んでいない問いはおすすめ）。
 * おすすめの付いていない問いが1つでもあれば null
 */
function resolvePicks(questions: QuestionItem[], answers: AnswerInput["answers"]): Chosen[] | null {
  if (questions.length === 0) return null;
  const picks: Chosen[] = [];
  for (const item of questions) {
    const recommended = item.options.find((option) => option.recommended);
    if (!recommended) return null;
    const chosen = item.options.find((option) => option.letter === answers[item.number]?.choice);
    picks.push({ item, option: chosen ?? recommended });
  }
  return picks;
}

/** 2問以上で、全部の問いにおすすめがあるか（`おすすめで全部答える` を出してよいか） */
export function canAnswerAllRecommended(questions: QuestionItem[]): boolean {
  return questions.length >= 2 && resolvePicks(questions, {}) !== null;
}

/** おすすめ以外の選択肢を選んでいる問いがあるか（あれば、ボタンは `残りをおすすめで答える`） */
export function hasOtherPick(questions: QuestionItem[], answers: AnswerInput["answers"]): boolean {
  return questions.some((item) => {
    const chosen = item.options.find((option) => option.letter === answers[item.number]?.choice);
    return chosen !== undefined && !chosen.recommended;
  });
}

/**
 * 送る文：`Q1はB、Q2はB、Q3はA`。選んでいる物を優先し、残りをおすすめで埋める。
 * 問いに書いた補足は `Q1はB：補足` と残し、画面案を選んでいれば頭に `A。`、ほかに伝えたいことは下に足す
 * （`composeAnswer` と同じ）。おすすめの無い問いがあれば null
 */
export function composeRecommendedAnswer(
  question: Pick<ParsedQuestion, "questions" | "mockups">,
  input: AnswerInput,
): string | null {
  const picks = resolvePicks(question.questions, input.answers);
  if (!picks) return null;
  const line = picks
    .map(({ item, option }) => {
      const note = (input.answers[item.number]?.note ?? "").trim().replace(/[。.]+$/, "");
      const head = `Q${item.number}は${option.letter}`;
      return note === "" ? head : `${head}：${note}`;
    })
    .join("、");
  const mockup = question.mockups.find((m) => m.letter === input.mockup);
  const body = mockup ? `${mockup.letter}。${line}` : line;
  const extra = input.note.trim();
  return extra === "" ? body : `${body}\n\n${extra}`;
}

/** 押したあとの中身の1行：`Q1 CPU の時間 · Q2 Issue のコメント · Q3 30分ごとの点検`（選択肢の見出し）。おすすめの無い問いがあれば null */
export function recommendedSummary(questions: QuestionItem[], answers: AnswerInput["answers"]): string | null {
  const picks = resolvePicks(questions, answers);
  if (!picks) return null;
  return picks.map(({ item, option }) => `Q${item.number} ${splitChoice(option.text).head}`).join(" · ");
}
