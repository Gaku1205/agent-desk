"use client";

import { useEffect, useRef, useState, useTransition, type KeyboardEvent } from "react";
import { runOperation } from "@/app/actions";
import { isMergeWeak, mergeResultLines } from "@/lib/mergeLines";
import { getProgress } from "@/lib/progress";
import { splitPhrases, turnKind } from "@/lib/turnKind";
import type { OperationKind, TurnItem } from "@/lib/turn";
import { useDemo } from "./DemoContext";
import { SmartLink } from "./SmartLink";
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
  // 操作が通った時点の段階とボタン。取り直しで変わったら（行が残るなら）元に戻す
  const sig = `${status.stage}:${buttons.map((b) => b.label).join(",")}`;
  const [leavingSig, setLeavingSig] = useState<string | null>(null);
  const leaving = leavingSig === sig;
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

  useEffect(() => {
    if (leavingSig === null) return;
    // 取り直しが古い内容のままでも、行が見えないまま残らないようにする
    const timer = window.setTimeout(() => setLeavingSig(null), 6000);
    return () => window.clearTimeout(timer);
  }, [leavingSig]);

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
      else setLeavingSig(sig);
    });
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape" && confirming) {
      event.stopPropagation();
      setConfirming(false);
    }
  }

  const lines = confirming && merge ? mergeResultLines(merge) : null;
  const weak = merge ? isMergeWeak(merge) : false;
  const phrases = lines ? [] : splitPhrases(item.description);
  // 強い色は止まった（アンバー）・公開失敗（赤）の行だけ。ほかは静かな色
  const calm = kind.tone === "calm";

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
        <SmartLink href={issue.url}>{issue.title}</SmartLink>
      </h3>
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
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <div className={styles.foot}>
        <div className={styles.acts} data-tone={kind.tone}>
          {confirming && merge ? (
            <>
              <button
                ref={confirmRef}
                type="button"
                className={`${styles.act} ${styles.fill}`}
                data-act=""
                data-weak={weak ? "" : undefined}
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
                data-act=""
                disabled={pending}
                onClick={() => setConfirming(false)}
              >
                やめる
              </button>
            </>
          ) : (
            buttons.map((button) =>
              button.type === "link" ? (
                <SmartLink key={button.label} className={styles.act} href={button.href} data-act="">
                  {button.label}
                </SmartLink>
              ) : (
                <button
                  key={button.kind}
                  type="button"
                  className={styles.act}
                  data-act=""
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
          <Ticks progress={progress} calm={calm} />
          <span className={styles.stage} data-tone={calm ? "calm" : progress.tone}>
            {progress.currentName}
          </span>
        </div>
      </div>
    </article>
  );
}
