"use client";

import { useRouter } from "next/navigation";
import { startTransition, useEffect, useLayoutEffect, useRef, useState, useTransition, type KeyboardEvent } from "react";
import { runOperation } from "@/app/actions";
import { ACTION_UNREACHABLE_MESSAGE, callAction } from "@/lib/actionCall";
import type { OperationResult } from "@/lib/operations";
import { nextRowIndex } from "@/lib/focusAfterLeave";
import { isMergeWeak, mergeResultLines } from "@/lib/mergeLines";
import { DEMO_OP_DELAY_MS } from "@/lib/demo/ops";
import { doneSummary, OPERATION_COPY, RESULT_FADE_MS, RESULT_SHOW_MS } from "@/lib/operationResult";
import { getProgress } from "@/lib/progress";
import { composeAnswer, type AnswerInput } from "@/lib/question";
import { groupLabel, splitPhrases, titlesWhatHappened, turnKind, turnSource } from "@/lib/turnKind";
import { presetAnswer } from "@/lib/choiceText";
import { OPERATION_LABEL, type OperationKind, type TurnItem } from "@/lib/turn";
import { useDemo } from "./DemoContext";
import { DoneResult } from "./DoneResult";
import { SpinnerIcon } from "./icons";
import flowStyles from "./FlowMap.module.css";
import { QuestionForm } from "./QuestionForm";
import { FactoryForm } from "./FactoryForm";
import {
  FACTORY_GO,
  composeFactoryAnswer,
  emptyFactoryInput,
  factoryAnswerText,
  type FactoryInput,
} from "@/lib/factoryTalk";
import { SmartLink } from "./SmartLink";
import { TurnKindIcon } from "./TurnKindIcon";
import styles from "./TurnRow.module.css";

type Props = {
  item: TurnItem;
  wait: string;
  /** 前の1件を片づけて替わった1件（短いフェードで出す） */
  fresh: boolean;
  /** 片づけ始めた・片づけるのをやめた（次の1件に替え、件数を取り直しを待たずに減らす） */
  onLeave: (key: string, leaving: boolean) => void;
  /** 押してから片づけるまで、この1件の中身を預ける（done：結果を出し始めた。件数を減らす）。null で預かりをやめる */
  onHold: (key: string, hold: { item: TurnItem; done: boolean } | null) => void;
  /** マージ待ちの一覧の1行として描く（順番の数。無ければ大きい1件） */
  queue?: { num: number };
  /** ホームの真ん中の1件（スマホで主役のボタンを幅いっぱいにする） */
  home?: boolean;
  /** スマホの `飛ばす`（右の列の次の1件へ）。待ちが1件だけなら渡さない */
  onSkip?: () => void;
};

/** 押した操作の段階：押している間（`〜中…`）→ 結果（`〜しました`）→ 消えていく */
type Op = { kind: OperationKind; phase: "busy" | "done" | "fading" };

/** 押したボタンの `〜中…`：前に進捗図の進行中と同じ回る印（docs/design.md の「押したあとの結果」） */
function BusyLabel({ kind }: { kind: OperationKind }) {
  return (
    <>
      <span className={`${flowStyles.spin} ${styles.busyMark}`} aria-hidden="true">
        <SpinnerIcon />
      </span>
      {OPERATION_COPY[kind].busy}
    </>
  );
}

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
  // 大きい1件（article）も、マージ待ちの一覧の行（listitem）も、同じ並びの中の `data-key` の付いた行
  const rows = Array.from(row.parentElement?.children ?? []).filter(
    (el): el is HTMLElement => el instanceof HTMLElement && el.hasAttribute("data-key"),
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
export function TurnRow({ item, wait, fresh, onLeave, onHold, queue, home = false, onSkip }: Props) {
  const { owner, repo, issue, status, buttons, merge } = item;
  const key = `${owner}/${repo}#${issue.number}`;
  const kind = turnKind(status);
  const progress = getProgress(status);
  // 工場の相談は、工場の今の段の名前（相談待ち → 動いている段 → 通常の段階名）
  const stageName =
    item.factoryFlow?.steps.find((step) => step.state === "waiting")?.name ??
    item.factoryFlow?.steps.find((step) => step.state === "running")?.name ??
    progress.currentName;
  const router = useRouter();
  const [pending, startAction] = useTransition();
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
  const rowRef = useRef<HTMLElement | null>(null);
  const demo = useDemo();
  const isDemo = demo !== null;
  // 押した操作（押している間・結果・消えていく）。結果を見せ終えたら片づける
  const [op, setOp] = useState<Op | null>(null);
  const phase = op?.phase ?? null;
  const busy = op?.phase === "busy" ? op.kind : null;
  const blocked = pending || op !== null;
  // 押した時点の段階とボタン（結果を見せ終えて片づけるときに使う）
  const opSig = useRef(sig);
  // 結果を出した時点でフォーカスが1件の中にあった：「閉じる」へ移す
  const focusClose = useRef(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  // 企画AIの質問：画面で選んだ・書いた答えと、そこから組み立てた送る文
  const asking = status.stage === "question";
  // おすすめの選択肢を最初から選んでおく（docs/spec.md の「ホーム（決める画面）」）
  const [answer, setAnswer] = useState<AnswerInput>(() => presetAnswer(item.question ?? null));
  const whatHappened = titlesWhatHappened(status.stage);
  const source = turnSource(status.stage);
  // 工場の相談：選んだ・書いた物は、その相談のコメントの間だけ覚える（次の段階に変わったら空に戻す）
  const talking = status.stage === "factoryTalk";
  const talkId = item.factory?.commentId ?? null;
  const [factoryState, setFactoryState] = useState<{ id: number | null; value: FactoryInput }>(() => ({
    id: talkId,
    value: emptyFactoryInput(),
  }));
  const factoryInput = factoryState.id === talkId ? factoryState.value : emptyFactoryInput();
  const factoryTalk = item.factory ?? { stage: null, choices: [], questions: [] };  const answerText = asking
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

  // デモ：データに当てるまで（0.42秒）を「〜中…」にし、そのあと結果を出す
  useEffect(() => {
    if (phase !== "busy" || !isDemo) return;
    const timer = window.setTimeout(() => {
      focusClose.current = rowRef.current?.contains(document.activeElement) ?? false;
      setConfirming(false);
      setOp((prev) => (prev ? { ...prev, phase: "done" } : prev));
    }, DEMO_OP_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [phase, isDemo]);

  // 結果を2.4秒見せたら、0.15秒で消してから片づける
  useEffect(() => {
    if (phase === "done") {
      if (focusClose.current) {
        focusClose.current = false;
        closeRef.current?.focus();
      }
      const timer = window.setTimeout(
        () => setOp((prev) => (prev ? { ...prev, phase: "fading" } : prev)),
        RESULT_SHOW_MS,
      );
      return () => window.clearTimeout(timer);
    }
    if (phase === "fading") {
      const timer = window.setTimeout(() => {
        // 結果が消える前に、フォーカスの移し先を決めて移す
        if (rowRef.current) moveFocusOutOf(rowRef.current);
        setLeavingSig(opSig.current);
        setOp(null);
      }, RESULT_FADE_MS);
      return () => window.clearTimeout(timer);
    }
  }, [phase]);

  // 押してから片づけるまで、この1件の中身を Desk に預ける（取り直しで消えても、結果を見せ終えるまで残す）
  const holding = phase === null ? null : phase === "busy" ? "busy" : "done";
  useLayoutEffect(() => {
    onHold(key, holding === null ? null : { item, done: holding === "done" });
  }, [holding, key, item, onHold]);

  useEffect(() => () => onHold(key, null), [key, onHold]);

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

  /** 結果を見せ終える前に「閉じる」を押した：フェードせず、すぐ片づける */
  function closeResult() {
    if (rowRef.current) moveFocusOutOf(rowRef.current);
    setLeavingSig(opSig.current);
    setOp(null);
  }

  /** 操作が通った：行の中身を結果に置き換える */
  function succeed() {
    focusClose.current = rowRef.current?.contains(document.activeElement) ?? false;
    setConfirming(false);
    setOp((prev) => (prev ? { ...prev, phase: "done" } : prev));
  }

  /** 最終確認の「作る」：選んだ答えと一緒に、そのまま送る（「答えを送る」をもう一度押させない） */
  function sendGo() {
    const body = composeFactoryAnswer(factoryTalk, { ...factoryInput, pick: FACTORY_GO });
    setFactoryState({ id: talkId, value: { ...factoryInput, pick: FACTORY_GO } });
    run("answer", body);
  }

  function run(kind: OperationKind, bodyOverride?: string) {
    if (blocked) return;
    const sendBody = bodyOverride ?? answerBody;
    if (kind === "answer" && (bodyOverride ?? answerText).trim() === "") {
      // 何も選んでいない・書いていない答えは送らない
      setError(EMPTY_ANSWER_MESSAGE);
      return;
    }
    setError(null);
    setHit(kind);
    opSig.current = sig;
    setOp({ kind, phase: "busy" });
    if (demo) {
      // デモ：サンプルのデータの上で本当に段階を進める（0.42秒遅れて。その間は「〜中…」）
      demo.operate({ owner, repo, number: issue.number }, kind, kind === "answer" ? sendBody : undefined);
      return;
    }
    startAction(async () => {
      // 呼び出しが投げても（通信が切れた・古い画面のまま押した）、画面を落とさず、理由をこの行に出す（書きかけの答えを残す）
      const result = await callAction<OperationResult>(
        () =>
          runOperation({
            kind,
            owner,
            repo,
            issueNumber: issue.number,
            ...(kind === "answer" ? { answer: sendBody } : {}),
          }),
        () => ({ ok: false, changed: false, message: ACTION_UNREACHABLE_MESSAGE }),
      );
      if (!result.ok && !result.changed) {
        // 元のボタン（マージは「マージする」）と説明文に戻し、理由を出す
        setOp(null);
        setError(result.message);
        return;
      }
      // 画面の取り直しは裏で行う（骨組みに戻さず、届くまで今の中身を出し続ける）
      startTransition(() => router.refresh());
      if (result.ok) {
        succeed();
      } else {
        // 押した時点で段階が変わっていて何もしなかった：結果は出さず、今までどおりすぐ片づける
        if (rowRef.current) moveFocusOutOf(rowRef.current);
        setConfirming(false);
        setLeavingSig(opSig.current);
        setOp(null);
      }
    });
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape" && confirming && !blocked) {
      event.stopPropagation();
      closeConfirm();
    }
  }

  const lines = confirming && merge && !busy ? mergeResultLines(merge) : null;
  const weak = merge ? isMergeWeak(merge) : false;
  // 押している間は、説明文の所に今していること
  const doing = busy ? OPERATION_COPY[busy].doing : null;
  const phrases = lines ? [] : splitPhrases(doing ?? item.description);
  const done = op && op.phase !== "busy" ? doneSummary(op.kind, item) : null;
  const fading = phase === "fading" ? "" : undefined;

  // マージの確認のボタン（大きい1件も一覧の行も同じ）
  const confirmButtons = (
    <>
      <button
        ref={confirmRef}
        type="button"
        className={`${styles.act} ${styles.primary}`}
        data-act=""
        data-weak={weak ? "" : undefined}
        data-busy={busy === "merge" ? "" : undefined}
        aria-disabled={blocked ? "true" : undefined}
        onClick={() => run("merge")}
        onKeyDown={(event) => {
          // 押し続けた Enter の繰り返しで、意図せずマージしない
          if (event.key === "Enter" && event.repeat) event.preventDefault();
        }}
      >
        {busy === "merge" ? <BusyLabel kind="merge" /> : "マージする"}
      </button>
      <button
        type="button"
        className={`${styles.act} ${styles.ghost}`}
        data-act=""
        aria-disabled={blocked ? "true" : undefined}
        onClick={() => {
          if (!blocked) closeConfirm();
        }}
      >
        やめる
      </button>
    </>
  );

  if (queue) {
    // マージ待ちの一覧の1行（docs/design.md の「マージ待ちの一覧」）。マージの操作は大きい1件と同じ
    const request = status.holdRequest?.split("\n")[0].trim() ?? "";
    const refText = item.pullOnly ? `${repo} PR #${issue.number}` : `${repo}#${issue.number}`;
    const first = queue.num === 1;
    return (
      // 一覧の1行は article にしない（「あなたの番」の大きい1件ではなく、順番つきの一覧の項目。並びは Desk の role="list"）
      <div
        ref={(el) => {
          rowRef.current = el;
        }}
        role="listitem"
        className={styles.qrow}
        data-key={key}
        data-queue=""
        data-leaving={leaving ? "" : undefined}
        data-fading={fading}
        inert={leaving}
        onKeyDown={onKeyDown}
      >
        <span className={`${styles.qnum} num`}>{queue.num}</span>
        <div className={styles.qmain}>
          <div className={styles.qhead}>
            <span className={`${styles.id} num`}>{refText}</span>
            <span className={`${styles.wait} num`}>{wait}</span>
          </div>
          <h3 className={styles.qtitle}>
            <SmartLink href={issue.url}>{issue.title}</SmartLink>
          </h3>
          {done && <DoneResult summary={done} compact onClose={closeResult} closeRef={closeRef} />}
          {doing && <p className={styles.qreq}>{doing}</p>}
          {request && !lines && !doing && !done && <p className={styles.qreq}>{request}</p>}
          {item.note && !lines && !doing && !done && <p className={styles.qreq}>{item.note}</p>}
          {merge && merge.review === null && !lines && !doing && !done && (
            <p className={styles.qsoft}>AIのレビューなし・中身を見てから</p>
          )}
          {lines && (
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
          )}
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
        </div>
        {!done && (
          <div className={`${styles.acts} ${styles.qacts}`}>
            {confirming && merge ? (
              confirmButtons
            ) : (
              <button
                ref={mergeRef}
                type="button"
                className={`${styles.act} ${first ? styles.primary : styles.text}`}
                data-act=""
                data-pre-tap=""
                data-hit={hit === "merge" ? "" : undefined}
                aria-disabled={blocked ? "true" : undefined}
                onClick={() => {
                  if (!blocked) setConfirming(true);
                }}
              >
                {OPERATION_LABEL.merge}
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <article
      ref={rowRef}
      className={styles.row}
      data-key={key}
      data-group={kind.group}
      data-answer={asking || talking ? "" : undefined}
      data-fresh={fresh ? "" : undefined}
      data-home={home ? "" : undefined}
      data-leaving={leaving ? "" : undefined}
      data-fading={fading}
      inert={leaving}
      onKeyDown={onKeyDown}
    >
      <div className={styles.head}>
        <span className={styles.kind} title={kind.label}>
          <TurnKindIcon icon={kind.icon} />
          {groupLabel(kind.group)}
        </span>
        <span className={`${styles.id} num`}>
          {item.pullOnly ? `${repo}　PR #${issue.number}` : `${repo}#${issue.number}`}
          {!item.pullOnly && status.pull ? `　PR #${status.pull.number}` : ""}
        </span>
        {whatHappened && (
          <span className={styles.issueName}>
            <SmartLink href={issue.url}>{issue.title}</SmartLink>
          </span>
        )}
        {source && <span className={styles.source}>{source}</span>}
        <span className={`${styles.wait} num`}>{wait}</span>
        <span className={styles.stage}>{stageName}</span>
      </div>
      <h2 className={styles.title}>
        {whatHappened ? item.description : <SmartLink href={issue.url}>{issue.title}</SmartLink>}
      </h2>
      {done ? (
        // 通った：説明文・補足・答える欄・ボタンを、その場で結果に置き換える
        <DoneResult summary={done} onClose={closeResult} closeRef={closeRef} />
      ) : (
        <>
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
          ) : whatHappened && !doing ? null : (
            <p className={styles.desc}>
              {phrases.map((phrase, i) => (
                <span className="ph" key={i}>
                  {phrase}
                </span>
              ))}
            </p>
          )}
          {item.note && !lines && !whatHappened && <p className={styles.note}>{item.note}</p>}
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
                onGo={sendGo}
                disabled={blocked}
              />
            </div>
          )}
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
          <div className={styles.acts} data-group={kind.group}>
            {confirming && merge
              ? confirmButtons
              : buttons.map((button, index) => {
                  const role = index === 0 ? styles.primary : "";
                  const primary = index === 0 ? "" : undefined;
                  // Answer の主役のボタンは `答えて次へ`（横に Enter のキーの印）
                  const label =
                    button.type === "operation" && button.kind === "answer" ? (
                      <>
                        答えて次へ
                        <kbd className={styles.enterKey} aria-hidden="true">
                          Enter
                        </kbd>
                      </>
                    ) : (
                      button.label
                    );
                  return button.type === "link" ? (
                    <SmartLink
                      key={button.label}
                      className={`${styles.act} ${role}`}
                      href={button.href}
                      data-act=""
                      data-primary={primary}
                    >
                      {button.label}
                    </SmartLink>
                  ) : (
                    <button
                      key={button.kind}
                      ref={button.kind === "merge" ? mergeRef : undefined}
                      type="button"
                      className={`${styles.act} ${role}`}
                      data-act=""
                      data-primary={primary}
                      // 流し直してよい押し（Issue #615）。答えるは入力が要るので印を付けない
                      data-pre-tap={button.kind === "answer" ? undefined : ""}
                      data-hit={hit === button.kind ? "" : undefined}
                      data-busy={busy === button.kind ? "" : undefined}
                      aria-disabled={
                        blocked || (button.kind === "answer" && answerText.trim() === "") ? "true" : undefined
                      }
                      onClick={() => {
                        if (blocked) return;
                        if (button.kind === "merge") setConfirming(true);
                        else run(button.kind);
                      }}
                    >
                      {busy === button.kind ? <BusyLabel kind={button.kind} /> : label}
                    </button>
                  );
                })}
            {item.logUrl && (
              <a className={styles.link} href={item.logUrl} target="_blank" rel="noreferrer">
                ログを開く ↗
              </a>
            )}
            <span className={styles.keysHint} aria-hidden="true">
              <span className="num">S</span> で飛ばす · <span className="num">J</span> / <span className="num">K</span> で選ぶ
            </span>
            {onSkip && (
              <button type="button" className={styles.skip} onClick={onSkip}>
                飛ばす
              </button>
            )}
          </div>
        </>
      )}
    </article>
  );
}
