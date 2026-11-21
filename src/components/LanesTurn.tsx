"use client";

import { useRouter } from "next/navigation";
import { startTransition, useEffect, useRef, useState, useTransition } from "react";
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
import { MarqueeText } from "./MarqueeText";
import { SmartLink } from "./SmartLink";
import { TurnKindIcon } from "./TurnKindIcon";

type Props = {
  item: TurnItem;
  wait: string;
  /** マージ待ちが2件以上のときの、すすめる順（1から）。それ以外は null */
  mergeOrder: number | null;
  /** 答える欄が要る物を開くリンクの頭（デモでは `/demo`） */
  basePath: string;
  /** 押してから片づけるまで、この1件の中身を預ける（done：結果を出し始めた）。null で預かりをやめる */
  onHold: (key: string, hold: { item: TurnItem; done: boolean } | null) => void;
  /** 結果を見せ終えた：この行を片づける */
  onGone: (key: string, sig: string) => void;
};

/** フォーカスが片づける行の中にあるときだけ、次の行の最初のボタン（無ければ区画の見出し）へ移す */
function moveFocusOutOf(row: HTMLElement) {
  if (!row.contains(document.activeElement)) return;
  const rows = Array.from(row.parentElement?.children ?? []).filter(
    (el): el is HTMLElement => el instanceof HTMLElement && el.hasAttribute("data-key") && el !== row,
  );
  const after = rows.filter((el) => row.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING);
  const next = [...after, ...rows.filter((el) => !after.includes(el))].find((el) => !el.hasAttribute("data-fading"));
  const target =
    next?.querySelector<HTMLElement>('[data-act]:not([aria-disabled="true"])') ??
    next?.querySelector<HTMLElement>("a, button") ??
    row.closest("section")?.querySelector<HTMLElement>("h2");
  if (target && !target.matches("a, button")) target.tabIndex = -1;
  target?.focus();
}

type Op = { kind: OperationKind; phase: "busy" | "done" | "fading" };

/** Slots & Queue の Your turn の1行（docs/design.md の「Slots & Queue」）。ボタンの動きは「あなたの番」（`TurnRow`）と同じ */
export function LanesTurn({ item, wait, mergeOrder, basePath, onHold, onGone }: Props) {
  const { owner, repo, issue, status, buttons, merge } = item;
  const key = turnItemKey(item);
  const sig = turnSig(item);
  const kind = turnKind(status);
  const demo = useDemo();
  const router = useRouter();
  const [, startAction] = useTransition();
  const [op, setOp] = useState<Op | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const rowRef = useRef<HTMLLIElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const mergeRef = useRef<HTMLButtonElement>(null);
  // 確認を閉じたとき「マージ…」へ、結果を出したとき「閉じる」へフォーカスを移す
  const restoreMergeFocus = useRef(false);
  const focusClose = useRef(false);
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

  useEffect(() => {
    if (confirming) confirmRef.current?.focus();
    else if (restoreMergeFocus.current) {
      restoreMergeFocus.current = false;
      mergeRef.current?.focus();
    }
  }, [confirming]);

  /** 結果を出す：フォーカスが行の中にあれば「閉じる」へ移す */
  function succeed() {
    focusClose.current = rowRef.current?.contains(document.activeElement) ?? false;
    setConfirming(false);
    setOp((prev) => (prev ? { ...prev, phase: "done" } : prev));
  }

  /** 行を片づける：フォーカスを外へ移してから */
  function leave() {
    if (rowRef.current) moveFocusOutOf(rowRef.current);
    onGone(key, opSig.current);
  }

  function closeConfirm() {
    restoreMergeFocus.current = true;
    setConfirming(false);
  }

  // デモ：データに当てるまで（0.42秒）を「〜中…」にし、そのあと結果を出す
  useEffect(() => {
    if (phase !== "busy" || demo === null) return;
    const timer = window.setTimeout(() => {
      focusClose.current = rowRef.current?.contains(document.activeElement) ?? false;
      setConfirming(false);
      setOp((prev) => (prev ? { ...prev, phase: "done" } : prev));
    }, DEMO_OP_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [phase, demo]);

  // 結果を2.4秒見せたら、0.15秒で消してから片づける
  useEffect(() => {
    if (phase === "done") {
      if (focusClose.current) {
        focusClose.current = false;
        closeRef.current?.focus();
      }
      const timer = window.setTimeout(() => setOp((prev) => (prev ? { ...prev, phase: "fading" } : prev)), RESULT_SHOW_MS);
      return () => window.clearTimeout(timer);
    }
    if (phase === "fading") {
      const timer = window.setTimeout(() => {
        if (rowRef.current) moveFocusOutOf(rowRef.current);
        onGone(key, opSig.current);
      }, RESULT_FADE_MS);
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
    startAction(async () => {
      const result = await callAction<OperationResult>(
        () => runOperation({ kind: operation, owner, repo, issueNumber: issue.number }),
        () => ({ ok: false, changed: false, message: ACTION_UNREACHABLE_MESSAGE }),
      );
      if (!result.ok && !result.changed) {
        setOp(null);
        setError(result.message);
        return;
      }
      // 画面の取り直しは裏で行う（骨組みに戻さず、届くまで今の中身を出し続ける）
      startTransition(() => router.refresh());
      if (result.ok) {
        succeed();
      } else {
        // 押した時点で段階が変わっていて何もしなかった：結果は出さず、すぐ片づける
        setConfirming(false);
        leave();
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
      ref={rowRef}
      onKeyDown={(event) => {
        if (event.key === "Escape" && confirming && !blocked) {
          event.stopPropagation();
          closeConfirm();
        }
      }}
      className={styles.row}
      data-kind="turn"
      data-marquee-row=""
      data-group={kind.group}
      data-key={key}
      data-fading={phase === "fading" ? "" : undefined}
    >
      <div className={styles.left}>
        <span className={styles.turnKind}>
          <TurnKindIcon icon={kind.icon} size={13} />
          {kind.label}
        </span>
        <span className={`${styles.ref} num`}>
          {ref}
          {mergeOrder !== null && ` · ${mergeOrder}番目`}
        </span>
      </div>
      <div className={styles.middle}>
        <a className={styles.turnTitle} href={issue.url} target="_blank" rel="noreferrer" title={issue.title}>
          <MarqueeText text={issue.title} />
        </a>
        {done ? (
          <DoneResult summary={done} compact noClose />
        ) : (
          <span
            className={styles.turnDesc}
            data-error={error ? "" : undefined}
            role={error ? "alert" : undefined}
            title={text}
          >
            {lines && !error
              ? lines.map((l, i) => (
                  <span key={l.name}>
                    {i > 0 && " · "}
                    {l.name === "review" && l.tone === "warn" ? (
                      <span className={styles.turnWarn}>{`${l.name} ${l.text}`}</span>
                    ) : (
                      `${l.name} ${l.text}`
                    )}
                  </span>
                ))
              : text}
          </span>
        )}
      </div>
      <div className={`${styles.right} ${styles.turnRight}`}>
        <span className={`${styles.time} num`}>{wait}</span>
        {done ? (
          <div className={styles.turnActs}>
            <button ref={closeRef} type="button" className={styles.turnClose} data-act="" onClick={leave}>
              閉じる
            </button>
          </div>
        ) : (
          <div className={styles.turnActs}>
            {asks ? (
              <SmartLink className={`${styles.turnAct} ${styles.turnPrimary}`} href={href} data-act="">
                {answerLinkLabel(item)}
              </SmartLink>
            ) : confirming && merge ? (
              <>
                <button
                  ref={confirmRef}
                  type="button"
                  className={`${styles.turnAct} ${styles.turnPrimary}`}
                  data-act=""
                  data-weak={weak ? "" : undefined}
                  data-busy={busy === "merge" ? "" : undefined}
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
                    if (!blocked) closeConfirm();
                  }}
                >
                  やめる
                </button>
              </>
            ) : (
              // 最初の1つ（おすすめ）がいちばん右で塗り。左に並べるほかのボタンは縁だけ
              [...buttons].reverse().map((button, i, all) =>
                button.type === "link" ? (
                  <SmartLink
                    key={button.label}
                    className={i === all.length - 1 ? `${styles.turnAct} ${styles.turnPrimary}` : styles.turnAct}
                    href={button.href}
                    data-act=""
                  >
                    {button.label}
                  </SmartLink>
                ) : (
                  <button
                    key={button.kind}
                    ref={button.kind === "merge" ? mergeRef : undefined}
                    type="button"
                    className={i === all.length - 1 ? `${styles.turnAct} ${styles.turnPrimary}` : styles.turnAct}
                    data-act=""
                    data-pre-tap={button.kind === "answer" ? undefined : ""}
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
