"use client";

import { useState, type SyntheticEvent } from "react";
import { viewerSlides, type ViewerSlide } from "@/lib/imageViewer";
import {
  FACTORY_FIX,
  FACTORY_REDO,
  MAX_FACTORY_NOTE,
  answerWithRecommended,
  factoryStageLabel,
  judgeLine,
  type FactoryChoice,
  type FactoryImage,
  type FactoryInput,
  type FactoryStage,
  type FactoryTalk,
} from "@/lib/factoryTalk";
import { ImageViewer } from "./ImageViewer";
import { PlayIcon, RedoIcon, WrenchIcon } from "./icons";
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
  /** 最終確認の「作る」を確かめたとき：答えをそのまま送る */
  onGo: () => void;
  /** 送っている間など、押せない間 */
  disabled?: boolean;
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

/** 画像を押したとき（見ている案の位置・案の中の画像の位置・押した物） */
type OpenViewer = (slide: number, image: number, opener: HTMLElement) => void;

/** 全体表示の開閉（開いている案と画像の位置、押した画像を覚える） */
function useViewer(slides: ViewerSlide[]) {
  const [view, setView] = useState<{ slide: number; image: number; opener: HTMLElement } | null>(null);
  const open: OpenViewer = (slide, image, opener) => setView({ slide, image, opener });
  const node = view && (
    <ImageViewer
      slides={slides}
      slide={view.slide}
      image={view.image}
      opener={view.opener}
      onChange={(slide, image) => setView({ ...view, slide, image })}
      onClose={() => setView(null)}
    />
  );
  return { open, node };
}

/** 画像を押すと全体表示（選ばない）。PC は幅の3/4、スマホは1/4 */
function Shots({
  images,
  label,
  slide,
  onOpen,
}: {
  images: FactoryImage[];
  label: string;
  slide: number;
  onOpen: OpenViewer;
}) {
  if (images.length === 0) return null;
  return (
    <span className={styles.shots}>
      {images.map((image, i) => {
        const alt = image.alt || `${label} ${image.device === "mobile" ? "スマホ" : "PC"}`;
        return (
          <button
            key={image.src}
            type="button"
            className={styles.shotBtn}
            data-device={image.device}
            data-only={images.length === 1 || undefined}
            aria-label={`${alt}を大きく見る`}
            onClick={(event) => onOpen(slide, i, event.currentTarget)}
          >
            {/* 工場のコメントの画像のURLをそのまま出す（外のサイトの画像なので next/image は使わない） */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={image.src}
              alt=""
              className={`${styles.shotImg} ${styles.img}`}
              loading="lazy"
              referrerPolicy="no-referrer"
              onError={hideBroken}
            />
          </button>
        );
      })}
    </span>
  );
}

function ChoiceBody({
  stage,
  choice,
  slide,
  onOpen,
}: {
  stage: FactoryStage;
  choice: FactoryChoice;
  /** 全体表示の並びの中の位置（画像が無ければ -1） */
  slide: number;
  onOpen: OpenViewer;
}) {
  return (
    <>
      {choice.sub && <span className={`${styles.sub} num`}>{choice.sub}</span>}
      {stage === "looks" && choice.images.length > 0 && (
        <button
          type="button"
          className={`${styles.board} ${styles.shotBtn}`}
          aria-label={`${choice.images[0].alt || `方向${choice.mark}`}を大きく見る`}
          onClick={(event) => onOpen(slide, 0, event.currentTarget)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={choice.images[0].src}
            alt=""
            className={`${styles.boardImg} ${styles.img}`}
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={hideBroken}
          />
        </button>
      )}
      {stage === "mocks" && <Shots images={choice.images} label={choice.mark} slide={slide} onOpen={onOpen} />}
      {choice.text &&<span className={styles.text}>{choice.text}</span>}
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
  const slides = viewerSlides(stage, choices);
  const viewer = useViewer(slides);
  const labelId = `${idPrefix}-factory`;
  const [head, ask] = HEADINGS[stage];
  return (
    <div className={q.item}>
      <p className={q.qtext} id={labelId}>
        <span className={`${q.qno} num`}>{head}</span>
        {ask}
      </p>
      {viewer.node}
      <div className={styles.grid} role="radiogroup" aria-labelledby={labelId}>
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
                  <RedoIcon />
                  <span className={styles.title}>全部ちがう</span>
                  {selected === FACTORY_REDO && <span className={q.mockPicked}>選んだ案</span>}
                </span>
                <span className={styles.sub}>変えたい所を書いて出し直す</span>
              </button>
            );
          }
          const checked = selected === choice.value;
          return (
            // カードは入れ物。選ぶのは見出し（role="radio"）か「この案にする」。画像は全体表示を開くだけ
            <div key={choice.value} className={`${q.mock} ${styles.card} ${styles.pickCard}`} data-checked={checked}>
              <button
                ref={(el) => {
                  roving.refs.current[i] = el;
                }}
                type="button"
                role="radio"
                aria-checked={checked}
                aria-label={`${choice.mark}：${choice.title}`}
                tabIndex={roving.tabIndexOf(i)}
                className={`${q.mockHead} ${styles.headBtn}`}
                onClick={() => roving.onClick(choice.value)}
                onKeyDown={(event) => roving.onKeyDown(event, i)}
              >
                <span className={q.mockLetter}>{choice.mark}</span>
                <span className={styles.title}>{choice.title}</span>
                {checked && <span className={q.mockPicked}>選んだ案</span>}
              </button>
              <ChoiceBody
                stage={stage}
                choice={choice}
                slide={slides.findIndex((s) => s.id === choice.value)}
                onOpen={viewer.open}
              />
              <button type="button" className={styles.pick} onClick={() => onSelect(choice.value)}>
                この案にする
              </button>
            </div>
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
  onGo,
  disabled,
  idPrefix,
}: {
  talk: FactoryTalk;
  selected: string | null;
  onSelect: (value: string | null) => void;
  onGo: () => void;
  disabled: boolean;
  idPrefix: string;
}) {
  // 「作る」を押したあとの確認の文（押すとそのまま送る）
  const [asking, setAsking] = useState(false);
  const labelId = `${idPrefix}-factory`;
  const [head, ask] = HEADINGS.confirm;
  const confirm = talk.confirm;
  const viewer = useViewer([{ id: "confirm", mark: "", title: "選んだ画面", images: confirm?.images ?? [] }]);
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
      {confirm && confirm.decided.length > 0 && (
        <table className={styles.decided} aria-label="決まった事">
          <thead>
            <tr>
              <th scope="col">決まった事（質問）</th>
              <th scope="col">答え</th>
            </tr>
          </thead>
          <tbody>
            {confirm.decided.map((row, i) => (
              <tr key={`${i}-${row.q}`}>
                <th scope="row">{row.q}</th>
                <td>{row.a}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {confirm && <Shots images={confirm.images} label="選んだ画面" slide={0} onOpen={viewer.open} />}
      {viewer.node}
      <div className={q.options} aria-labelledby={labelId} role="group">
        <button
          type="button"
          className={styles.goBtn}
          aria-expanded={asking}
          disabled={disabled}
          onClick={() => setAsking(true)}
        >
          <PlayIcon />
          <span>作る</span>
        </button>
        <button
          type="button"
          className={styles.goBtn}
          aria-pressed={selected === FACTORY_FIX}
          disabled={disabled}
          onClick={() => {
            setAsking(false);
            onSelect(FACTORY_FIX);
          }}
        >
          <WrenchIcon />
          <span>直す</span>
        </button>
      </div>
      {asking && (
        <p className={styles.goConfirm} role="group" aria-label="作る前の確認">
          <span>作り始めます。押すとすぐ送ります。</span>
          <button
            type="button"
            className={styles.goBtn}
            disabled={disabled}
            onClick={() => {
              setAsking(false);
              onGo();
            }}
          >
            作り始める
          </button>
          <button type="button" className={styles.goBtn} onClick={() => setAsking(false)}>
            やめる
          </button>
        </p>
      )}
    </div>
  );
}

/**
 * 工場の相談に答える欄（docs/design.md の「工場の相談に答える欄」）。選択肢のカード（全部ちがう）・最終確認の
 * 作る／直す・質問（企画AIの質問と同じ部品）・ほかに伝えたいこと、と、送る文の見本。送るのは行の「答えを送る」
 */
export function FactoryForm({ talk, value, onChange, idPrefix, preview, onGo, disabled = false }: Props) {
  const stage = talk?.stage ?? null;
  const redo = value.pick === FACTORY_REDO || value.pick === FACTORY_FIX;
  const select = (pick: string | null) => onChange({ ...value, pick });
  const questions = talk?.questions ?? [];
  const judge = talk?.judge ?? null;
  return (
    <div className={q.form}>
      {talk && stage !== null && (
        <p className={`${styles.stageHead} num`}>{factoryStageLabel(stage, talk.round)}</p>
      )}
      {talk?.notice && (
        <p className={styles.notice}>
          <span className={`${q.qno} num`}>工場から</span>
          {talk.notice}
        </p>
      )}
      {talk && stage === "confirm" && (
        <Confirm
          talk={talk}
          selected={value.pick}
          onSelect={select}
          onGo={onGo}
          disabled={disabled}
          idPrefix={idPrefix}
        />
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
      {questions.some((item) => item.options.some((o) => o.recommended)) && (
        <button
          type="button"
          className={styles.recAll}
          onClick={() => onChange({ ...value, answers: answerWithRecommended(questions, value.answers) })}
        >
          全部おすすめで答える
        </button>
      )}
      {questions.map((item) => (
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
      {judge && (
        <div className={styles.judge} data-failed={judge.passed ? undefined : ""}>
          <span>{judgeLine(judge)}</span>
          {!judge.passed && judge.issues.length > 0 && (
            <ul className={styles.judgeIssues} aria-label="残った指摘">
              {judge.issues.map((issue, i) => (
                <li key={`${i}-${issue}`}>{issue}</li>
              ))}
            </ul>
          )}
        </div>
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
