"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { runOperation } from "@/app/actions";
import { ACTION_UNREACHABLE_MESSAGE, callAction } from "@/lib/actionCall";
import { DEMO_OP_DELAY_MS } from "@/lib/demo/ops";
import { answerLinkLabel, needsAnswerForm } from "@/lib/lanes/turnRows";
import { isMergeWeak, mergeResultLines } from "@/lib/mergeLines";
import { doneSummary, OPERATION_COPY, RESULT_FADE_MS, RESULT_SHOW_MS } from "@/lib/operationResult";
import { turnItemKey, turnSig, type OperationKind, type TurnItem } from "@/lib/turn";
import { turnKind } from "@/lib/turnKind";
import type { OperationResult } from "@/lib/operations";
import { useDemo } from "./DemoContext";
import { DoneResult } from "./DoneResult";
import flowStyles from "./FlowMap.module.css";
import { SpinnerIcon } from "./icons";
import styles from "./Lanes.module.css";
import { SmartLink } from "./SmartLink";
import { TurnKindIcon } from "./TurnKindIcon";

type Props = {
  item: TurnItem;
  wait: string;
  /** 答える欄が要る物を開くリンクの頭（デモでは `/demo`） */
  basePath: string;
  /** 押してから片づけるまで、この1件の中身を預ける（done：結果を出し始めた）。null で預かりをやめる */
  onHold: (key: string, hold: { item: TurnItem; done: boolean } | null) => void;
  /** 結果を見せ終えた：この行を片づける */
  onGone: (key: string, sig: string) => void;
};

type Op = { kind: OperationKind; phase: "busy" | "done" | "fading" };

/** Slots & Queue の Your turn の1行（docs/design.md の「Slots & Queue」）。ボタンの動きは「あなたの番」（`TurnRow`）と同じ */
export function LanesTurn({ item, wait, basePath, onHold, onGone }: Props) {
  const { owner, repo, issue, status, buttons, merge } = item;
  const key = turnItemKey(item);
  const sig = turnSig(item);
  const kind = turnKind(status);
  const demo = useDemo();
  const [, startTransition] = useTransition();
  const [op, setOp] = useState<Op | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  // 押した時点の段階の印（片づけるときに使う）
  const opSig = useRef(sig);
  const phase = op?.phase ?? null;
  const busy = op?.phase === "busy" ? op.kind : null;
  const blocked = op !== null;

  // 押してから片づけるまで、この1件の中身を預かる（取り直しで消えても、結果を見せ終えるまで残す）
  useEffect(() => {
    onHold(key, phase === null ? null : { item, done: phase !== "busy" });
  }, [phase, key, item, onHold]);
  useEffect(() => () => onHold(key, null), [key, onHold]);

  // デモ：データに当てるまで（0.42秒）を「〜中…」にし、そのあと結果を出す
  useEffect(() => {
    if (phase !== "busy" || demo === null) return;
    const timer = window.setTimeout(() => {
      setConfirming(false);
      setOp((prev) => (prev ? { ...prev, phase: "done" } : prev));
    }, DEMO_OP_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [phase, demo]);

  // 結果を2.4秒見せたら、0.15秒で消してから片づける
  useEffect(() => {
    if (phase === "done") {
      const timer = window.setTimeout(() => setOp((prev) => (prev ? { ...prev, phase: "fading" } : prev)), RESULT_SHOW_MS);
      return () => window.clearTimeout(timer);
    }
    if (phase === "fading") {
      const timer = window.setTimeout(() => onGone(key, opSig.current), RESULT_FADE_MS);
      return () => window.clearTimeout(timer);
    }
  }, [phase, key, onGone]);

  function run(operation: OperationKind) {
    if (blocked) return;
    setError(null);
    opSig.current = sig;
    setOp({ kind: operation, phase: "busy" });
    if (demo) {
      demo.operate({ owner, repo, number: issue.number }, operation);
      return;
    }
    startTransition(async () => {
      const result = await callAction<OperationResult>(
        () => runOperation({ kind: operation, owner, repo, issueNumber: issue.number }),
        () => ({ ok: false, changed: false, message: ACTION_UNREACHABLE_MESSAGE }),
      );
      if (!result.ok && !result.changed) {
        setOp(null);
        setError(result.message);
      } else if (result.ok) {
        setConfirming(false);
        setOp((prev) => (prev ? { ...prev, phase: "done" } : prev));
      } else {
        // 押した時点で段階が変わっていて何もしなかった：結果は出さず、すぐ片づける
        setConfirming(false);
        onGone(key, opSig.current);
      }
    });
  }

  const ref = item.pullOnly ? `${repo} PR #${issue.number}` : `${repo}#${issue.number}`;
  const lines = confirming && merge && !busy ? mergeResultLines(merge) : null;
  const weak = merge ? isMergeWeak(merge) : false;
  const done = op && op.phase !== "busy" ? doneSummary(op.kind, item) : null;
  const doing = busy ? OPERATION_COPY[busy].doing : null;
  const firstLine = (lines ? lines.map((l) => `${l.name} ${l.text}`).join(" · ") : item.description).split("\n")[0];
  const text = error ?? doing ?? firstLine;
  const href = `${basePath}/repos/${owner}/${repo}`;
  const asks = needsAnswerForm(item);

  const busyLabel = (operation: OperationKind) => (
    <>
      <span className={`${flowStyles.spin} ${styles.turnBusy}`} aria-hidden="true">
        <SpinnerIcon />
      </span>
      {OPERATION_COPY[operation].busy}
    </>
  );

  return (
    <li
      className={styles.row}
      data-kind="turn"
      data-group={kind.group}
      data-key={key}
      data-fading={phase === "fading" ? "" : undefined}
    >
      <div className={styles.left}>
        <span className={styles.turnKind}>
          <TurnKindIcon icon={kind.icon} size={13} />
          {kind.label}
        </span>
        <span className={`${styles.ref} num`}>{ref}</span>
      </div>
      <div className={styles.middle}>
        <a className={styles.turnTitle} href={issue.url} target="_blank" rel="noreferrer" title={issue.title}>
          {issue.title}
        </a>
        {done ? (
          <DoneResult summary={done} compact onClose={() => onGone(key, opSig.current)} closeRef={closeRef} />
        ) : (
          <span
            className={styles.turnDesc}
            data-error={error ? "" : undefined}
            role={error ? "alert" : undefined}
            title={text}
          >
            {text}
          </span>
        )}
      </div>
      <div className={`${styles.right} ${styles.turnRight}`}>
        <span className={`${styles.time} num`}>{wait}</span>
        {!done && (
          <div className={styles.turnActs}>
            {asks ? (
              <SmartLink className={`${styles.turnAct} ${styles.turnPrimary}`} href={href} data-act="">
                {answerLinkLabel(item)}
              </SmartLink>
            ) : confirming && merge ? (
              <>
                <button
                  type="button"
                  className={`${styles.turnAct} ${styles.turnPrimary}`}
                  data-act=""
                  data-weak={weak ? "" : undefined}
                  aria-disabled={blocked ? "true" : undefined}
                  onClick={() => run("merge")}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && event.repeat) event.preventDefault();
                  }}
                >
                  {busy === "merge" ? busyLabel("merge") : "マージする"}
                </button>
                <button
                  type="button"
                  className={styles.turnAct}
                  data-act=""
                  aria-disabled={blocked ? "true" : undefined}
                  onClick={() => {
                    if (!blocked) setConfirming(false);
                  }}
                >
                  やめる
                </button>
              </>
            ) : (
              buttons.map((button) =>
                button.type === "link" ? (
                  <SmartLink
                    key={button.label}
                    className={`${styles.turnAct} ${styles.turnPrimary}`}
                    href={button.href}
                    data-act=""
                  >
                    {button.label}
                  </SmartLink>
                ) : (
                  <button
                    key={button.kind}
                    type="button"
                    className={`${styles.turnAct} ${styles.turnPrimary}`}
                    data-act=""
                    data-busy={busy === button.kind ? "" : undefined}
                    aria-disabled={blocked ? "true" : undefined}
                    onClick={() => {
                      if (blocked) return;
                      if (button.kind === "merge") setConfirming(true);
                      else run(button.kind);
                    }}
                  >
                    {busy === button.kind ? busyLabel(button.kind) : button.label}
                  </button>
                ),
              )
            )}
          </div>
        )}
      </div>
    </li>
  );
}
