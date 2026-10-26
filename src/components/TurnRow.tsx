"use client";

import { useState, useTransition, type CSSProperties, type ReactNode } from "react";
import { runOperation } from "@/app/actions";
import { toneRgba } from "@/lib/progress";
import type { MergeSummary, OperationKind, TurnButton } from "@/lib/turn";
import { useDemo } from "./DemoContext";
import { MergeDialog } from "./MergeDialog";
import pipelineStyles from "./PipelineTable.module.css";
import { PipelineTitle } from "./PipelineTitle";
import styles from "./TurnRow.module.css";
import { useRowEffects } from "./useRowEffects";

type Props = {
  owner: string;
  repo: string;
  issueNumber: number;
  title: string;
  /** 段階（取り直しで変わったら行を光らせる） */
  stage: string;
  url: string;
  description: string;
  wait: string;
  buttons: TurnButton[];
  merge: MergeSummary | null;
  /** 進み具合のバー */
  children: ReactNode;
};

/**
 * あなたの番の1行（ボタンを押すとサーバー側で操作して、画面を取り直す）。
 * 並べ方は行の幅で変わる（TurnRow.module.css）。切れているタイトルは行に乗せた間に流す
 */
export function TurnRow(props: Props) {
  const { owner, repo, issueNumber, buttons, merge } = props;
  const { fadeIn, flash } = useRowEffects(props.stage);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [mergeOpen, setMergeOpen] = useState(false);
  const demo = useDemo();

  function run(kind: OperationKind, onDone?: () => void) {
    setError(null);
    if (demo) {
      // デモでは何も書き込まず、動かないことを知らせる
      onDone?.();
      demo.notify();
      return;
    }
    startTransition(async () => {
      const result = await runOperation({ kind, owner, repo, issueNumber });
      onDone?.();
      if (!result.ok && !result.changed) setError(result.message);
    });
  }

  return (
    <li
      className={`${styles.row} ${pipelineStyles.marqueeHost}`}
      data-fade-in={fadeIn ? "true" : undefined}
      data-flash={flash ?? undefined}
      style={{ "--flash-color": toneRgba("human", 0.12) } as CSSProperties}
    >
      <div className={styles.grid}>
        <svg
          className={styles.icon}
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          strokeWidth="1.5"
          aria-hidden="true"
        >
          <circle cx="7" cy="7" r="5.5" stroke="var(--human)" />
          <circle cx="7" cy="7" r="2" fill="var(--human)" />
        </svg>
        <a className={`${styles.ref} mono`} href={props.url} target="_blank" rel="noreferrer">
          {repo}#{issueNumber}
        </a>
        <div className={styles.body}>
          <a className={styles.title} href={props.url} target="_blank" rel="noreferrer">
            <PipelineTitle title={props.title} className={styles.marqueeTitle} />
          </a>
          <p className={styles.desc}>{props.description}</p>
          <div className={styles.progress}>{props.children}</div>
          {error && (
            <p className={styles.opError} role="alert">
              {error}
            </p>
          )}
        </div>
        <span className={`${styles.wait} mono`}>{props.wait}</span>
        <div className={styles.buttons}>
          {buttons.map((button) =>
            button.type === "link" ? (
              <a
                key={button.label}
                className={styles.button}
                href={button.href}
                target="_blank"
                rel="noreferrer"
              >
                {button.label}
              </a>
            ) : (
              <button
                key={button.kind}
                type="button"
                className={styles.button}
                disabled={pending}
                onClick={() => (button.kind === "merge" ? setMergeOpen(true) : run(button.kind))}
              >
                {button.label}
              </button>
            ),
          )}
        </div>
      </div>
      {mergeOpen && merge && (
        <MergeDialog
          repo={repo}
          title={props.title}
          merge={merge}
          pending={pending}
          onCancel={() => setMergeOpen(false)}
          onConfirm={() => run("merge", () => setMergeOpen(false))}
        />
      )}
    </li>
  );
}
