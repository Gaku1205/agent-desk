"use client";

import { useRef, type KeyboardEvent } from "react";
import type { AnswerInput, MockupOption, ParsedQuestion, QuestionItem } from "@/lib/question";
import { codeParts, splitChoice } from "@/lib/choiceText";
import { rovingNext } from "@/lib/roving";
import { questionTabLabel } from "@/lib/questionAnswer";
import { OptionMarkIcon } from "./icons";
import styles from "./QuestionForm.module.css";

type Props = {
  /** 読めた質問（質問のコメントが無い・読めないときは null。自由な欄だけ出す） */
  question: ParsedQuestion | null;
  value: AnswerInput;
  onChange: (next: AnswerInput) => void;
  /** 行ごとに違う id の頭（`owner/repo#番号` から作る） */
  idPrefix: string;
  /** 送る文（画面で選んだ・書いた物から組み立てた物。空なら出さない） */
  preview: string;
  /** 2問以上のとき：今の問い（0から）と、切り替え。無ければ全部の問いを縦に並べる */
  step?: { current: number; onCurrent: (index: number) => void };
};

/** 文の中の `` `…` `` を、バッククォートを出さずにコードの見た目にする */
export function CodeText({ text }: { text: string }) {
  return (
    <>
      {codeParts(text).map((part, i) =>
        part.code ? (
          <code key={i} className={styles.code}>
            {part.text}
          </code>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </>
  );
}

/** 空の答え */
export function emptyAnswer(): AnswerInput {
  return { mockup: null, answers: {}, note: "" };
}

/**
 * 1つの選択（ラジオ）の並び。Tab で止まるのは選ばれている1つ（無ければ先頭）だけで、←→↑↓・Home・End で
 * フォーカスと選択が一緒に移る（`src/lib/roving.ts`）。選ばれている物をもう一度押すと選ばないに戻る
 */
export function useRoving<T extends string>(letters: T[], selected: T | null, select: (letter: T | null) => void) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const current = selected === null ? -1 : letters.indexOf(selected);
  const tabIndexOf = (i: number) => (i === (current === -1 ? 0 : current) ? 0 : -1);
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const next = rovingNext(event.key, i, letters.length);
    if (next === null) return;
    event.preventDefault();
    select(letters[next]);
    refs.current[next]?.focus();
  };
  const onClick = (letter: T) => select(selected === letter ? null : letter);
  return { refs, tabIndexOf, onKeyDown, onClick };
}

/** 1つの質問：質問の文・選択肢のボタン（おすすめに印）・自分で書く欄（工場の相談でも使う） */
export function QuestionBlock({
  item,
  answer,
  onAnswer,
  idPrefix,
  keyed = false,
}: {
  item: QuestionItem;
  answer: { choice: string | null; note: string };
  onAnswer: (next: { choice: string | null; note: string }) => void;
  idPrefix: string;
  /** 決める画面の形：左にキーの印、右に見出しと説明（docs/design.md の「ホーム（決める画面）」） */
  keyed?: boolean;
}) {
  const letters = item.options.map((o) => o.letter);
  const roving = useRoving(letters, answer.choice, (choice) => onAnswer({ ...answer, choice }));
  const labelId = `${idPrefix}-q${item.number}`;
  return (
    <div className={styles.item}>
      <p className={styles.qtext} id={labelId}>
        <span className={`${styles.qno} num`}>Q{item.number}</span>
        {item.text}
      </p>
      {item.options.length > 0 && keyed && (
        <div className={styles.choices} role="radiogroup" aria-labelledby={labelId} data-choices="">
          {item.options.map((option, i) => {
            const split = splitChoice(option.text);
            const checked = answer.choice === option.letter;
            return (
              <button
                key={option.letter}
                ref={(el) => {
                  roving.refs.current[i] = el;
                }}
                type="button"
                role="radio"
                aria-checked={checked}
                tabIndex={roving.tabIndexOf(i)}
                className={styles.choice}
                onClick={() => roving.onClick(option.letter)}
                onKeyDown={(event) => roving.onKeyDown(event, i)}
              >
                {i < 9 && (
                  <kbd className={`${styles.choiceKey} num`} aria-hidden="true">
                    {i + 1}
                  </kbd>
                )}
                <span className={styles.choiceText}>
                  <span className={styles.choiceHead}>
                    <CodeText text={split.head} />
                    {(option.recommended || split.recommended) && <span className={styles.choiceRec}>おすすめ</span>}
                  </span>
                  {split.body !== "" && (
                    <span className={styles.choiceBody}>
                      <CodeText text={split.body} />
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      )}
      {item.options.length > 0 && !keyed && (
        <div className={styles.options} role="radiogroup" aria-labelledby={labelId}>
          {item.options.map((option, i) => (
            <button
              key={option.letter}
              ref={(el) => {
                roving.refs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={answer.choice === option.letter}
              tabIndex={roving.tabIndexOf(i)}
              className={styles.option}
              onClick={() => roving.onClick(option.letter)}
              onKeyDown={(event) => roving.onKeyDown(event, i)}
            >
              <OptionMarkIcon checked={answer.choice === option.letter} />
              <span className={`${styles.letter} num`}>{option.letter}</span>
              <span>{option.text}</span>
              {option.recommended && <span className={styles.rec}>おすすめ</span>}
            </button>
          ))}
        </div>
      )}
      <input
        type="text"
        className={styles.note}
        aria-label={`Q${item.number} に自分で書く`}
        placeholder={item.options.length > 0 ? "自分で書く（なくてもよい）" : "答えを書く"}
        value={answer.note}
        onChange={(event) => onAnswer({ ...answer, note: event.target.value })}
      />
    </div>
  );
}

function Mockups({
  mockups,
  selected,
  onSelect,
  idPrefix,
}: {
  mockups: MockupOption[];
  selected: string | null;
  onSelect: (letter: string | null) => void;
  idPrefix: string;
}) {
  const letters = mockups.map((m) => m.letter as string);
  const roving = useRoving(letters, selected, onSelect);
  const labelId = `${idPrefix}-mockups`;
  return (
    <div className={styles.item}>
      <p className={styles.qtext} id={labelId}>
        <span className={`${styles.qno} num`}>画面案</span>
        どちらの画面にしますか
      </p>
      <div className={styles.mocks} role="radiogroup" aria-labelledby={labelId}>
        {mockups.map((mockup, i) => {
          const checked = selected === mockup.letter;
          return (
            <button
              key={mockup.letter}
              ref={(el) => {
                roving.refs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={checked}
              aria-label={`${mockup.letter}${mockup.label ? `：${mockup.label}` : ""}`}
              tabIndex={roving.tabIndexOf(i)}
              className={styles.mock}
              onClick={() => roving.onClick(mockup.letter)}
              onKeyDown={(event) => roving.onKeyDown(event, i)}
            >
              <span className={styles.mockHead}>
                <span className={styles.mockLetter}>{mockup.letter}</span>
                <span className={styles.mockLabel}>{mockup.label}</span>
                {checked && <span className={styles.mockPicked}>選んだ案</span>}
              </span>
              <span className={styles.shots}>
                {mockup.images.map((image) => (
                  // 画面案の画像は、質問のコメントの <img src> のURLをそのまま出す（外のサイトの画像なので next/image は使わない）
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={image.src}
                    src={image.src}
                    alt={image.alt || `${mockup.letter} ${image.device === "mobile" ? "スマホ" : "PC"}`}
                    className={styles.shot}
                    data-device={image.device}
                    loading="lazy"
                    referrerPolicy="no-referrer"
                  />
                ))}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * 企画AIの質問に答える欄（docs/design.md の「質問に答える欄」）。選択肢のボタン（おすすめに印）・自分で書く欄・
 * 画面案（A・B）・ほかに伝えたいこと、と、送る文の見本。送るのは行の「答えを送る」
 */
export function QuestionForm({ question, value, onChange, idPrefix, preview, step }: Props) {
  const questions = question?.questions ?? [];
  const mockups = question?.mockups ?? [];
  // 2問以上のときは、問いの切り替えを出し、今の問いだけを出す
  const shown = step ? questions.filter((_, i) => i === step.current) : questions;
  return (
    <div className={styles.form}>
      {step && (
        <div className={styles.tabs} role="group" aria-label="問いの切り替え">
          {questions.map((item, i) => (
            <button
              key={item.number}
              type="button"
              className={`${styles.tab} num`}
              aria-current={i === step.current ? "step" : undefined}
              onClick={() => step.onCurrent(i)}
            >
              {questionTabLabel(item)}
            </button>
          ))}
        </div>
      )}
      {shown.map((item) => (
        <QuestionBlock
          key={item.number}
          item={item}
          idPrefix={idPrefix}
          keyed
          answer={value.answers[item.number] ?? { choice: null, note: "" }}
          onAnswer={(next) => onChange({ ...value, answers: { ...value.answers, [item.number]: next } })}
        />
      ))}
      {mockups.length > 0 && (
        <Mockups
          mockups={mockups}
          selected={value.mockup}
          idPrefix={idPrefix}
          onSelect={(mockup) => onChange({ ...value, mockup })}
        />
      )}
      <textarea
        className={`${styles.note} ${styles.extra}`}
        aria-label="ほかに伝えたいこと"
        placeholder={questions.length + mockups.length > 0 ? "ほかに伝えたいこと（なくてもよい）" : "答えを書く"}
        rows={2}
        value={value.note}
        onChange={(event) => onChange({ ...value, note: event.target.value })}
      />
      <p className={styles.preview} aria-live="polite">
        {preview === "" ? (
          <span className={styles.previewEmpty}>選ぶか書くと、ここに送る文が出ます</span>
        ) : (
          <>
            <span className={styles.previewHead}>送る文</span>
            <span className={styles.previewText}>{preview}</span>
          </>
        )}
      </p>
    </div>
  );
}
