"use client";

import { useEffect, useLayoutEffect, useRef, useState, useTransition, type KeyboardEvent } from "react";
import { runOperation } from "@/app/actions";
import { nextRowIndex } from "@/lib/focusAfterLeave";
import { isMergeWeak, mergeResultLines } from "@/lib/mergeLines";
import { getProgress } from "@/lib/progress";
import { composeAnswer, type AnswerInput } from "@/lib/question";
import { splitPhrases, turnKind } from "@/lib/turnKind";
import type { OperationKind, TurnItem } from "@/lib/turn";
import { useDemo } from "./DemoContext";
import { emptyAnswer, QuestionForm } from "./QuestionForm";
import { FactoryForm } from "./FactoryForm";
import {
  composeFactoryAnswer,
  emptyFactoryInput,
  factoryAnswerText,
  type FactoryInput,
} from "@/lib/factoryTalk";
import { SmartLink } from "./SmartLink";
import styles from "./TurnRow.module.css";

type Props = {
  item: TurnItem;
  wait: string;
  /** 前の1件を片づけて替わった1件（短いフェードで出す） */
  fresh: boolean;
  /** 片づけ始めた・片づけるのをやめた（次の1件に替え、件数を取り直しを待たずに減らす） */
  onLeave: (key: string, leaving: boolean) => void;
};

/** 操作が通っても段階が変わらないまま、片づけておく長さ */
const LEAVE_MS = 8000;

/** 何も選ばず・書かずに「答えを送る」を押したとき */
const EMPTY_ANSWER_MESSAGE = "選ぶか書いてから送ってください";

/**
 * フォーカスが片づける1件の中にあるときだけ、次の1件の最初のボタン（無ければリンク）へ移す。次が無ければ見出しへ。
 * 次の1件はまだ出ていないことが多いので、そのときは見出しへ移し、Desk が次の1件が出たあとで移し直す
 */
function moveFocusOutOf(row: HTMLElement) {
  if (!row.contains(document.activeElement)) return;
  const rows = Array.from(row.parentElement?.children ?? []).filter(
    (el): el is HTMLElement => el instanceof HTMLElement && el.tagName === "ARTICLE",
  );
  const next = nextRowIndex(
    rows.map((el) => el.hasAttribute("data-leaving")),
    rows.indexOf(row),
  );
  const target =
    next === null
      ? document.getElementById("turn-title")
      : (rows[next].querySelector<HTMLElement>('[data-act]:not([aria-disabled="true"])') ??
        rows[next].querySelector<HTMLElement>("a, button"));
  target?.focus();
}

/**
 * 「あなたの番」の1件（docs/design.md の「あなたの番」）。種類の札 → 題名 → 説明文 → 答える欄 → ボタン。
 * ボタンはサーバー側で操作して、画面を取り直す。「マージ…」はその場で「マージする／やめる」に変わる（確認）
 */
export function TurnRow({ item, wait, fresh, onLeave }: Props) {
  const { owner, repo, issue, status, buttons, merge } = item;
  const key = `${owner}/${repo}#${issue.number}`;
  const kind = turnKind(status);
  const progress = getProgress(status);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [hit, setHit] = useState<string | null>(null);
  // 操作が通った時点の段階とボタン。取り直しで変わったら（1件が残るなら）元に戻す
  // 工場の相談は、次の段階の相談が来たら（コメントが替わったら）、同じ段階でも元に戻す
  const sig = `${status.stage}:${buttons.map((b) => b.label).join(",")}:${item.factory?.commentId ?? ""}`;
  const [leavingSig, setLeavingSig] = useState<string | null>(null);
  const leaving = leavingSig === sig;
  const confirmRef = useRef<HTMLButtonElement>(null);
  const mergeRef = useRef<HTMLButtonElement>(null);
  // 確認を閉じたとき「マージ…」へフォーカスを戻す
  const restoreMergeFocus = useRef(false);
  const rowRef = useRef<HTMLElement>(null);
  const demo = useDemo();
  // 企画AIの質問：画面で選んだ・書いた答えと、そこから組み立てた送る文
  const asking = status.stage === "question";
  const [answer, setAnswer] = useState<AnswerInput>(emptyAnswer);
  // 工場の相談：選んだ・書いた物は、その相談のコメントの間だけ覚える（次の段階に変わったら空に戻す）
  const talking = status.stage === "factoryTalk";
  const talkId = item.factory?.commentId ?? null;
  const [factoryState, setFactoryState] = useState<{ id: number | null; value: FactoryInput }>(() => ({
    id: talkId,
    value: emptyFactoryInput(),
  }));
  const factoryInput = factoryState.id === talkId ? factoryState.value : emptyFactoryInput();
  const factoryTalk = item.factory ?? { stage: null, choices: [], questions: [] };
  const answerText = asking
    ? composeAnswer(item.question ?? { questions: [], mockups: [] }, answer)
    : talking
      ? factoryAnswerText(factoryTalk, factoryInput)
      : "";
  // 送るコメント（工場の相談は、見本の文の下に印を付ける）
  const answerBody = talking ? composeFactoryAnswer(factoryTalk, factoryInput) : answerText;

  useEffect(() => {
    if (confirming) confirmRef.current?.focus();
    else if (restoreMergeFocus.current) {
      restoreMergeFocus.current = false;
      mergeRef.current?.focus();
    }
  }, [confirming]);

  useEffect(() => {
    if (hit === null) return;
    const timer = window.setTimeout(() => setHit(null), 220);
    return () => window.clearTimeout(timer);
  }, [hit]);

  useEffect(() => {
    if (leavingSig === null) return;
    // 取り直しが古い内容のままでも、1件が隠れたまま残らないようにする
    const timer = window.setTimeout(() => setLeavingSig(null), LEAVE_MS);
    return () => window.clearTimeout(timer);
  }, [leavingSig]);

  // 片づける：フォーカスが中にあれば外へ移してから、次の1件に替える（件数は取り直しを待たずに減らす）
  useLayoutEffect(() => {
    const row = rowRef.current;
    if (leaving && row) moveFocusOutOf(row);
    onLeave(key, leaving);
  }, [leaving, key, onLeave]);

  useEffect(() => () => onLeave(key, false), [key, onLeave]);

  function closeConfirm() {
    restoreMergeFocus.current = true;
    setConfirming(false);
  }

  function run(kind: OperationKind) {
    if (pending) return;
    if (kind === "answer" && answerText.trim() === "") {
      // 何も選んでいない・書いていない答えは送らない
      setError(EMPTY_ANSWER_MESSAGE);
      return;
    }
    setError(null);
    setHit(kind);
    if (demo) {
      // デモ：サンプルのデータの上で本当に段階を進める（少し遅れて）
      // 確認のボタンが消える前に、フォーカスの移し先を決めて移す
      if (rowRef.current) moveFocusOutOf(rowRef.current);
      setConfirming(false);
      setLeavingSig(sig);
      demo.operate({ owner, repo, number: issue.number }, kind, kind === "answer" ? answerBody : undefined);
      return;
    }
    startTransition(async () => {
      const result = await runOperation({
        kind,
        owner,
        repo,
        issueNumber: issue.number,
        ...(kind === "answer" ? { answer: answerBody } : {}),
      });
      if (!result.ok && !result.changed) {
        closeConfirm();
        setError(result.message);
      } else {
        // 確認のボタンが消える前に、フォーカスの移し先を決めて移す
        if (rowRef.current) moveFocusOutOf(rowRef.current);
        setConfirming(false);
        setLeavingSig(sig);
      }
    });
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape" && confirming) {
      event.stopPropagation();
      closeConfirm();
    }
  }

  const lines = confirming && merge ? mergeResultLines(merge) : null;
  const weak = merge ? isMergeWeak(merge) : false;
  const phrases = lines ? [] : splitPhrases(item.description);

  return (
    <article
      ref={rowRef}
      className={styles.row}
      data-key={key}
      data-answer={asking || talking ? "" : undefined}
      data-fresh={fresh ? "" : undefined}
      data-leaving={leaving ? "" : undefined}
      inert={leaving}
      onKeyDown={onKeyDown}
    >
      <div className={styles.head}>
        <span className={styles.kind} data-tone={kind.tone}>
          {kind.label}
        </span>
        <span className={`${styles.id} num`}>
          {repo}#{issue.number}
          {status.pull ? `　PR #${status.pull.number}` : ""}
        </span>
        <span className={`${styles.wait} num`}>{wait}</span>
        <span className={styles.stage}>{progress.currentName}</span>
      </div>
      <h2 className={styles.title}>
        <SmartLink href={issue.url}>{issue.title}</SmartLink>
      </h2>
      {lines ? (
        <ul className={styles.lines} aria-label="マージの前の確認">
          {lines.map((line) => (
            <li key={line.name} data-tone={line.tone}>
              <span className={styles.mark} aria-hidden="true">
                {line.mark}
              </span>
              <span className={styles.lname}>{line.name}</span>
              <span className={styles.lres}>{line.text}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.desc}>
          {phrases.map((phrase, i) => (
            <span className="ph" key={i}>
              {phrase}
            </span>
          ))}
        </p>
      )}
      {item.note && !lines && <p className={styles.note}>{item.note}</p>}
      {asking && (
        <div className={styles.form}>
          <QuestionForm
            question={item.question}
            value={answer}
            onChange={(next) => {
              setAnswer(next);
              if (error === EMPTY_ANSWER_MESSAGE) setError(null);
            }}
            idPrefix={`turn-${owner}-${repo}-${issue.number}`}
            preview={answerText}
          />
        </div>
      )}
      {talking && (
        <div className={styles.form}>
          <FactoryForm
            talk={item.factory}
            value={factoryInput}
            onChange={(next) => {
              setFactoryState({ id: talkId, value: next });
              if (error === EMPTY_ANSWER_MESSAGE) setError(null);
            }}
            idPrefix={`turn-${owner}-${repo}-${issue.number}`}
            preview={answerText}
          />
        </div>
      )}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <div className={styles.acts} data-tone={kind.tone}>
        {confirming && merge ? (
          <>
            <button
              ref={confirmRef}
              type="button"
              className={`${styles.act} ${styles.primary}`}
              data-act=""
              data-weak={weak ? "" : undefined}
              aria-disabled={pending ? "true" : undefined}
              onClick={() => run("merge")}
              onKeyDown={(event) => {
                // 押し続けた Enter の繰り返しで、意図せずマージしない
                if (event.key === "Enter" && event.repeat) event.preventDefault();
              }}
            >
              {pending ? "マージ中…" : "マージする"}
            </button>
            <button
              type="button"
              className={`${styles.act} ${styles.ghost}`}
              data-act=""
              aria-disabled={pending ? "true" : undefined}
              onClick={() => {
                if (!pending) closeConfirm();
              }}
            >
              やめる
            </button>
          </>
        ) : (
          buttons.map((button, index) => {
            const role = index === 0 ? styles.primary : "";
            return button.type === "link" ? (
              <SmartLink key={button.label} className={`${styles.act} ${role}`} href={button.href} data-act="">
                {button.label}
              </SmartLink>
            ) : (
              <button
                key={button.kind}
                ref={button.kind === "merge" ? mergeRef : undefined}
                type="button"
                className={`${styles.act} ${role}`}
                data-act=""
                data-hit={hit === button.kind ? "" : undefined}
                aria-disabled={pending || (button.kind === "answer" && answerText.trim() === "") ? "true" : undefined}
                onClick={() => {
                  if (pending) return;
                  if (button.kind === "merge") setConfirming(true);
                  else run(button.kind);
                }}
              >
                {pending && button.kind === "answer" ? "送信中…" : button.label}
              </button>
            );
          })
        )}
        {item.logUrl && (
          <a className={styles.link} href={item.logUrl} target="_blank" rel="noreferrer">
            ログを開く ↗
          </a>
        )}
      </div>
    </article>
  );
}
