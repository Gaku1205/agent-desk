"use client";

import { useRouter } from "next/navigation";
import { startTransition as startRefresh, useCallback, useEffect, useRef, useState, useTransition } from "react";
import { runOperation } from "@/app/actions";
import { ACTION_UNREACHABLE_MESSAGE, callAction } from "@/lib/actionCall";
import { DEMO_OP_DELAY_MS } from "@/lib/demo/ops";
import { formatSpan } from "@/lib/dashboard/duration";
import { heldPausedIndex, withHeldPaused, type HeldPaused } from "@/lib/lanes/pausedHold";
import type { PausedEntry } from "@/lib/lanes/source";
import { OPERATION_COPY, RESULT_SHOW_MS } from "@/lib/operationResult";
import type { OperationResult } from "@/lib/operations";
import { useDemo } from "./DemoContext";
import styles from "./Lanes.module.css";

/** 片づけた1行を隠しておく長さ（Your turn の `TURN_LEAVE_MS` と同じ） */
const HIDE_MS = 8000;

type Phase ="idle" | "busy" | "done" | "gone";

/** Paused の1行（Issue #520。docs/design.md の「Slots & Queue」）：理由・止めてからの時間・`今すぐ始める` */
function PausedRow({
  entry,
  now,
  onHold,
  onGone,
}: {
  entry: PausedEntry;
  now: Date;
  /** 押してから片づけるまで、この1行の中身を預ける。null で預かりをやめる */
  onHold: (key: string, entry: PausedEntry | null) => void;
  /** 結果を見せ終えた：この行を片づける */
  onGone: (key: string) => void;
}) {
  const demo = useDemo();
  const router = useRouter();
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

  // 押してから片づけるまで、この1行の中身を預ける（取り直しで一覧から外れても、結果を見せ終えるまで残す）
  useEffect(() => {
    onHold(entry.key, phase === "idle" || phase === "gone" ? null : entry);
  }, [phase, entry, onHold]);

  // 結果を見せたら片づける
  useEffect(() => {
    if (phase !== "done") return;
    const timer = window.setTimeout(() => {
      setPhase("gone");
      onGone(entry.key);
    }, RESULT_SHOW_MS);
    return () => window.clearTimeout(timer);
  }, [phase, entry.key, onGone]);

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
        // 画面の取り直しは裏で行う（骨組みに戻さず、届くまで今の中身を出し続ける）
        startRefresh(() => router.refresh());
        if (result.ok) {
          setPhase("done");
        } else {
          // 押した時点で状態が変わっていて何もしなかった：結果は出さず、すぐ片づける
          setPhase("gone");
          onGone(entry.key);
        }
      }
    });
  }

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
  const [held, setHeld] = useState<ReadonlyMap<string, HeldPaused>>(() => new Map());
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());
  const entriesRef = useRef(entries);
  useEffect(() => {
    entriesRef.current = entries;
  });

  const hold = useCallback((key: string, value: PausedEntry | null) => {
    setHeld((prev) => {
      const before = prev.get(key);
      if (value === null) {
        if (!before) return prev;
        const next = new Map(prev);
        next.delete(key);
        return next;
      }
      if (before) return prev;
      const next = new Map(prev);
      next.set(key, { entry: value, index: heldPausedIndex(undefined, entriesRef.current, key) });
      return next;
    });
  }, []);

  const gotAway = useCallback((key: string) => {
    setHidden((prev) => new Set(prev).add(key));
    // 取り直しが古い内容のままでも、1件が隠れたまま残らないようにする（Your turn と同じ8秒）
    window.setTimeout(() => {
      setHidden((prev) => {
        if (!prev.has(key)) return prev;
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }, HIDE_MS);
    setHeld((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Map(prev);
      next.delete(key);
      return next;
    });
  }, []);

  const shown = withHeldPaused(entries, held, hidden);
  return (
    <ul className={styles.list}>
      {shown.map((entry) => (
        <PausedRow key={entry.key} entry={entry} now={now} onHold={hold} onGone={gotAway} />
      ))}
    </ul>
  );
}
