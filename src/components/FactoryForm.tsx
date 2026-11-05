"use client";

import type { SyntheticEvent } from "react";
import {
  FACTORY_FIX,
  FACTORY_GO,
  FACTORY_REDO,
  MAX_FACTORY_NOTE,
  type FactoryChoice,
  type FactoryImage,
  type FactoryInput,
  type FactoryStage,
  type FactoryTalk,
} from "@/lib/factoryTalk";
import { QuestionBlock, useRoving } from "./QuestionForm";
import q from "./QuestionForm.module.css";
import styles from "./FactoryForm.module.css";

type Props = {
  /** 読めた工場の相談（工場の相談のコメントが無いときは null。「答えを書く」の欄だけ出す） */
  talk: FactoryTalk | null;
  value: FactoryInput;
  onChange: (next: FactoryInput) => void;
  /** 行ごとに違う id の頭 */
  idPrefix: string;
  /** 送る文の見本（印は入れない。空なら出さない） */
  preview: string;
};

/** 段階の見出し（docs/design.md の「工場の相談に答える欄」） */
const HEADINGS: Record<FactoryStage, [string, string]> = {
  ideas: ["案", "どれを作りますか"],
  looks: ["見た目", "どの方向にしますか"],
  mocks: ["画面", "どちらの画面にしますか"],
  confirm: ["最終確認", "これで作り始めますか"],
};

/** 読めなかった画像は隠す（壊れた画像の印を出さない） */
function hideBroken(event: SyntheticEvent<HTMLImageElement>) {
  event.currentTarget.dataset.broken = "";
}

function Shots({ images, label }: { images: FactoryImage[]; label: string }) {
  if (images.length === 0) return null;
  return (
    <span className={q.shots}>
      {images.map((image) => (
        // 工場のコメントの画像のURLをそのまま出す（外のサイトの画像なので next/image は使わない）
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={image.src}
          src={image.src}
          alt={image.alt || `${label} ${image.device === "mobile" ? "スマホ" : "PC"}`}
          className={`${q.shot} ${styles.img}`}
          data-device={image.device}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={hideBroken}
        />
      ))}
    </span>
  );
}

function ChoiceBody({ stage, choice }: { stage: FactoryStage; choice: FactoryChoice }) {
  return (
    <>
      {choice.sub && <span className={`${styles.sub} num`}>{choice.sub}</span>}
      {stage === "looks" && choice.images.length > 0 && (
        <span className={styles.board}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={choice.images[0].src}
            alt={choice.images[0].alt || `方向${choice.mark}`}
            className={`${styles.boardImg} ${styles.img}`}
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={hideBroken}
          />
        </span>
      )}
      {stage === "mocks" && <Shots images={choice.images} label={choice.mark} />}
      {choice.text && <span className={styles.text}>{choice.text}</span>}
      {choice.facts.length > 0 && (
        <span className={styles.facts}>
          {choice.facts.map((fact) => (
            <span key={fact.label} className={styles.fact}>
              <span className={styles.factLabel}>{fact.label}</span>
              <span className={styles.factValue}>{fact.value}</span>
            </span>
          ))}
        </span>
      )}
      {(choice.colors.length > 0 || choice.fonts) && (
        <span className={styles.swatches}>
          {choice.colors.map((color) => (
            <span key={color} className={styles.swatch} style={{ background: color }} title={color} />
          ))}
          {choice.fonts && <span className={styles.fonts}>{choice.fonts}</span>}
        </span>
      )}
    </>
  );
}

/** 選択肢のカード（1つだけ選べる）。最後は「全部ちがう」 */
function Choices({
  stage,
  choices,
  selected,
  onSelect,
  idPrefix,
}: {
  stage: Exclude<FactoryStage, "confirm">;
  choices: FactoryChoice[];
  selected: string | null;
  onSelect: (value: string | null) => void;
  idPrefix: string;
}) {
  const values = [...choices.map((c) => c.value), FACTORY_REDO];
  const roving = useRoving(values, selected, onSelect);
  const labelId = `${idPrefix}-factory`;
  const [head, ask] = HEADINGS[stage];
  return (
    <div className={q.item}>
      <p className={q.qtext} id={labelId}>
        <span className={`${q.qno} num`}>{head}</span>
        {ask}
      </p>
      <div className={q.mocks} role="radiogroup" aria-labelledby={labelId}>
        {[...choices, null].map((choice, i) => {
          if (choice === null) {
            // 最後は「全部ちがう」（どう変えてほしいかを書いて、出し直してもらう）
            return (
              <button
                key={FACTORY_REDO}
                ref={(el) => {
                  roving.refs.current[i] = el;
                }}
                type="button"
                role="radio"
                aria-checked={selected === FACTORY_REDO}
                tabIndex={roving.tabIndexOf(i)}
                className={`${q.mock} ${styles.card} ${styles.redo}`}
                onClick={() => roving.onClick(FACTORY_REDO)}
                onKeyDown={(event) => roving.onKeyDown(event, i)}
              >
                <span className={q.mockHead}>
                  <span className={styles.title}>全部ちがう</span>
                  {selected === FACTORY_REDO && <span className={q.mockPicked}>選んだ案</span>}
                </span>
                <span className={styles.sub}>どう変えてほしいかを書いて、出し直してもらう</span>
              </button>
            );
          }
          const checked = selected === choice.value;
          return (
            <button
              key={choice.value}
              ref={(el) => {
                roving.refs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={checked}
              aria-label={`${choice.mark}：${choice.title}`}
              tabIndex={roving.tabIndexOf(i)}
              className={`${q.mock} ${styles.card}`}
              onClick={() => roving.onClick(choice.value)}
              onKeyDown={(event) => roving.onKeyDown(event, i)}
            >
              <span className={q.mockHead}>
                <span className={q.mockLetter}>{choice.mark}</span>
                <span className={styles.title}>{choice.title}</span>
                {checked && <span className={q.mockPicked}>選んだ案</span>}
              </span>
              <ChoiceBody stage={stage} choice={choice} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** 最終確認：まとめ・選んだ画面・「作る」「直す」 */
function Confirm({
  talk,
  selected,
  onSelect,
  idPrefix,
}: {
  talk: FactoryTalk;
  selected: string | null;
  onSelect: (value: string | null) => void;
  idPrefix: string;
}) {
  const values = [FACTORY_GO, FACTORY_FIX];
  const roving = useRoving(values, selected, onSelect);
  const labelId = `${idPrefix}-factory`;
  const [head, ask] = HEADINGS.confirm;
  const confirm = talk.confirm;
  return (
    <div className={q.item}>
      <p className={q.qtext} id={labelId}>
        <span className={`${q.qno} num`}>{head}</span>
        {ask}
      </p>
      {confirm && confirm.facts.length > 0 && (
        <dl className={styles.summary}>
          {confirm.facts.map((fact) => (
            <div key={fact.label} className={styles.summaryRow}>
              <dt>{fact.label}</dt>
              <dd>{fact.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {confirm && <Shots images={confirm.images} label="選んだ画面" />}
      <div className={q.options} role="radiogroup" aria-labelledby={labelId}>
        {values.map((value, i) => (
          <button
            key={value}
            ref={(el) => {
              roving.refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected === value}
            tabIndex={roving.tabIndexOf(i)}
            className={q.option}
            onClick={() => roving.onClick(value)}
            onKeyDown={(event) => roving.onKeyDown(event, i)}
          >
            <span>{value === FACTORY_GO ? "作る" : "直す"}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * 工場の相談に答える欄（docs/design.md の「工場の相談に答える欄」）。選択肢のカード（全部ちがう）・最終確認の
 * 作る／直す・質問（企画AIの質問と同じ部品）・ほかに伝えたいこと、と、送る文の見本。送るのは行の「答えを送る」
 */
export function FactoryForm({ talk, value, onChange, idPrefix, preview }: Props) {
  const stage = talk?.stage ?? null;
  const redo = value.pick === FACTORY_REDO || value.pick === FACTORY_FIX;
  const select = (pick: string | null) => onChange({ ...value, pick });
  return (
    <div className={q.form}>
      {talk?.notice && (
        <p className={styles.notice}>
          <span className={`${q.qno} num`}>工場から</span>
          {talk.notice}
        </p>
      )}
      {talk && stage === "confirm" && (
        <Confirm talk={talk} selected={value.pick} onSelect={select} idPrefix={idPrefix} />
      )}
      {talk && stage !== null && stage !== "confirm" && (
        <Choices stage={stage} choices={talk.choices} selected={value.pick} onSelect={select} idPrefix={idPrefix} />
      )}
      {stage !== null && redo && (
        <textarea
          className={`${q.note} ${q.extra}`}
          aria-label={value.pick === FACTORY_FIX ? "直してほしい内容" : "どう変えてほしいか"}
          placeholder={value.pick === FACTORY_FIX ? "直してほしい内容を書く" : "どう変えてほしいかを書く"}
          rows={2}
          maxLength={MAX_FACTORY_NOTE}
          value={value.redoNote}
          onChange={(event) => onChange({ ...value, redoNote: event.target.value })}
        />
      )}
      {(talk?.questions ?? []).map((item) => (
        <QuestionBlock
          key={item.number}
          item={item}
          idPrefix={`${idPrefix}-factory`}
          answer={value.answers[item.number] ?? { choice: null, note: "" }}
          onAnswer={(next) => onChange({ ...value, answers: { ...value.answers, [item.number]: next } })}
        />
      ))}
      {!redo && (
        <textarea
          className={`${q.note} ${q.extra}`}
          aria-label="ほかに伝えたいこと"
          placeholder={stage === null ? "答えを書く" : "ほかに伝えたいこと（なくてもよい）"}
          rows={2}
          maxLength={stage === null ? undefined : MAX_FACTORY_NOTE}
          value={value.note}
          onChange={(event) => onChange({ ...value, note: event.target.value })}
        />
      )}
      <p className={q.preview} aria-live="polite">
        {preview === "" ? (
          <span className={q.previewEmpty}>選ぶか書くと、ここに送る文が出ます</span>
        ) : (
          <>
            <span className={q.previewHead}>送る文</span>
            <span className={q.previewText}>{preview}</span>
          </>
        )}
      </p>
    </div>
  );
}
