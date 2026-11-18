"use client";

import { useEffect, useState, useTransition } from "react";
import { runOperation } from "@/app/actions";
import { ACTION_UNREACHABLE_MESSAGE, callAction } from "@/lib/actionCall";
import { DEMO_OP_DELAY_MS } from "@/lib/demo/ops";
import { formatSpan } from "@/lib/dashboard/duration";
import type { PausedEntry } from "@/lib/lanes/source";
import { OPERATION_COPY, RESULT_SHOW_MS } from "@/lib/operationResult";
import type { OperationResult } from "@/lib/operations";
import { useDemo } from "./DemoContext";
import styles from "./Lanes.module.css";

type Phase = "idle" | "busy" | "done" | "gone";

/** Paused の1行（Issue #520。docs/design.md の「Slots & Queue」）：理由・止めてからの時間・`今すぐ始める` */
function PausedRow({ entry, now }: { entry: PausedEntry; now: Date }) {
  const demo = useDemo();
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const since = entry.pausedAt === null ? null : formatSpan(Math.max(0, now.getTime() - entry.pausedAt));

  // デモ：データに当てるまで（0.42秒）を「開始中…」にする
  useEffect(() => {
    if (phase !== "busy" || demo === null) return;
    const timer = window.setTimeout(() => setPhase("done"), DEMO_OP_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [phase, demo]);

  // 結果を見せたら消す
  useEffect(() => {
    if (phase !== "done") return;
    const timer = window.setTimeout(() => setPhase("gone"), RESULT_SHOW_MS);
    return () => window.clearTimeout(timer);
  }, [phase]);

  function start() {
    if (phase !== "idle") return;
    setError(null);
    setPhase("busy");
    if (demo) {
      demo.operate({ owner: entry.owner, repo: entry.repo, number: entry.number }, "start");
      return;
    }
    startTransition(async () => {
      const result = await callAction<OperationResult>(
        () => runOperation({ kind: "start", owner: entry.owner, repo: entry.repo, issueNumber: entry.number }),
        () => ({ ok: false, changed: false, message: ACTION_UNREACHABLE_MESSAGE }),
      );
      if (!result.ok && !result.changed) {
        setPhase("idle");
        setError(result.message);
      } else {
        setPhase(result.ok ? "done" : "gone");
      }
    });
  }

  if (phase === "gone") return null;
  const text = error ?? entry.reason;
  return (
    <li className={styles.row} data-kind="paused">
      <div className={styles.left}>
        <span className={`${styles.ref} num`}>
          {entry.repo}#{entry.number}
        </span>
      </div>
      <div className={styles.middle}>
        <a className={styles.queueTitle} href={entry.url} target="_blank" rel="noreferrer" title={entry.title}>
          {entry.title}
        </a>
        <span
          className={styles.pausedReason}
          data-error={error ? "" : undefined}
          role={error ? "alert" : undefined}
          title={text}
        >
          {phase === "done" ? OPERATION_COPY.start.done : text}
        </span>
      </div>
      <div className={`${styles.right} ${styles.pausedRight}`}>
        {since !== null && <span className={`${styles.time} num`}>{since}</span>}
        <button
          type="button"
          className={styles.pausedAct}
          aria-disabled={phase !== "idle" ? "true" : undefined}
          onClick={start}
        >
          {phase === "busy" ? OPERATION_COPY.start.busy : "今すぐ始める"}
        </button>
      </div>
    </li>
  );
}

/** Paused の行の一覧 */
export function PausedList({ entries, now }: { entries: readonly PausedEntry[]; now: Date }) {
  return (
    <ul className={styles.list}>
      {entries.map((entry) => (
        <PausedRow key={entry.key} entry={entry} now={now} />
      ))}
    </ul>
  );
}
