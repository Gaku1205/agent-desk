"use client";

import { useEffect, useRef, useState, useTransition, type KeyboardEvent } from "react";
import { runOperation } from "@/app/actions";
import { mergeResultLines } from "@/lib/mergeLines";
import { getProgress } from "@/lib/progress";
import { splitPhrases, turnKind } from "@/lib/turnKind";
import type { OperationKind, TurnItem } from "@/lib/turn";
import { useDemo } from "./DemoContext";
import { Ticks } from "./Ticks";
import styles from "./TurnRow.module.css";
import { useRowEffects } from "./useRowEffects";

type Props = {
  item: TurnItem;
  wait: string;
  /** 行に乗せた・離れた（流れの光を強める） */
  onHover: (key: string | null) => void;
  /** ボタンを押した（流れの光が跳ねる） */
  onPress: (key: string) => void;
};

/**
 * 押す列の1件（docs/design.md の「押す列」）。種類の札 → 題名 → 理由 → ボタンと目盛り。
 * ボタンはサーバー側で操作して、画面を取り直す。「マージ…」はその場で「マージする／やめる」に変わる（確認）
 */
export function TurnRow({ item, wait, onHover, onPress }: Props) {
  const { owner, repo, issue, status, buttons, merge } = item;
  const key = `${owner}/${repo}#${issue.number}`;
  const kind = turnKind(status);
  const progress = getProgress(status);
  const { fadeIn, flash } = useRowEffects(status.stage);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [hit, setHit] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const demo = useDemo();

  useEffect(() => {
    if (confirming) confirmRef.current?.focus();
  }, [confirming]);

  useEffect(() => {
    if (hit === null) return;
    const timer = window.setTimeout(() => setHit(null), 220);
    return () => window.clearTimeout(timer);
  }, [hit]);

  function run(kind: OperationKind) {
    setError(null);
    setHit(kind);
    onPress(key);
    if (demo) {
      setConfirming(false);
      demo.notify();
      return;
    }
    startTransition(async () => {
      const result = await runOperation({ kind, owner, repo, issueNumber: issue.number });
      setConfirming(false);
      if (!result.ok && !result.changed) setError(result.message);
      else setLeaving(true);
    });
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape" && confirming) {
      event.stopPropagation();
      setConfirming(false);
    }
  }

  const phrases = confirming && merge ? mergeResultLines(merge) : splitPhrases(item.description);

  return (
    <article
      className={styles.row}
      data-key={key}
      data-fade-in={fadeIn ? "" : undefined}
      data-flash={flash ?? undefined}
      data-leaving={leaving ? "" : undefined}
      onMouseEnter={() => onHover(key)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => onHover(key)}
      onBlur={() => onHover(null)}
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
      </div>
      <h3 className={styles.title}>
        <a href={issue.url} target="_blank" rel="noreferrer">
          {issue.title}
        </a>
      </h3>
      <p className={styles.desc} data-lines={confirming && merge ? "" : undefined}>
        {phrases.map((phrase, i) => (
          <span className="ph" key={i}>
            {phrase}
          </span>
        ))}
      </p>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <div className={styles.foot}>
        <div className={styles.acts}>
          {confirming && merge ? (
            <>
              <button
                ref={confirmRef}
                type="button"
                className={`${styles.act} ${styles.fill}`}
                disabled={pending}
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
                disabled={pending}
                onClick={() => setConfirming(false)}
              >
                やめる
              </button>
            </>
          ) : (
            buttons.map((button) =>
              button.type === "link" ? (
                <a key={button.label} className={styles.act} href={button.href} target="_blank" rel="noreferrer">
                  {button.label}
                </a>
              ) : (
                <button
                  key={button.kind}
                  type="button"
                  className={styles.act}
                  data-hit={hit === button.kind ? "" : undefined}
                  disabled={pending}
                  onClick={() => (button.kind === "merge" ? setConfirming(true) : run(button.kind))}
                >
                  {button.label}
                </button>
              ),
            )
          )}
          {item.logUrl && (
            <a className={styles.link} href={item.logUrl} target="_blank" rel="noreferrer">
              ログを開く ↗
            </a>
          )}
        </div>
        <div className={styles.prog}>
          <Ticks progress={progress} />
          <span className={styles.stage} data-tone={progress.tone}>
            {progress.currentName}
          </span>
        </div>
      </div>
    </article>
  );
}
