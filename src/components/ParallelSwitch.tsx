"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { buildLanesSource } from "@/lib/lanes/source";
import {
  describeParallelFolded,
  describeParallelUsage,
  parallelBadge,
  parallelCells,
  parallelChoiceLabel,
  selectedParallelChoice,
  type ParallelChoice,
} from "@/lib/parallelSwitch";
import { useDemo } from "./DemoContext";
import { useStreamedNav } from "./NavContext";
import { useParallelView } from "./ParallelContext";
import styles from "./ParallelSwitch.module.css";

const CHOICES: ParallelChoice[] = ["auto", "night", "day"];

/** 枠を使っている作業の数（Slots & Queue の「使用中」と同じ数え方）。まだ届いていなければ null */
export function useSlotsInUse(): number | null {
  const demo = useDemo();
  const streamed = useStreamedNav();
  const demoCount = useMemo(
    () => (demo ? buildLanesSource(demo.results, demo.now).works.length : null),
    [demo],
  );
  return demo ? demoCount : (streamed?.slotsInUse ?? null);
}

/** 席のマス（使っている席＝緑の塗り、空いている席＝縁だけ、その時間は使えない席＝点線の縁） */
function Cells({ cells }: { cells: ReturnType<typeof parallelCells> }) {
  return (
    <span className={styles.cells} aria-hidden="true">
      {cells.map((cell, index) => (
        <i key={index} className={styles.cell} data-cell={cell} />
      ))}
    </span>
  );
}

/** 3択（自動・夜の数・昼の数）。`role="radiogroup"`。←→・↑↓ で隣へ（端では反対の端へ回る） */
function Choices({ busy, onChoose }: { busy: boolean; onChoose: (choice: ParallelChoice) => void }) {
  const view = useParallelView();
  const groupRef = useRef<HTMLDivElement>(null);
  if (!view?.state || !view.settings) return null;
  const selected = selectedParallelChoice(view.state);
  const { settings } = view;

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const step =
      event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = CHOICES[(index + step + CHOICES.length) % CHOICES.length];
    onChoose(next);
    groupRef.current?.querySelectorAll<HTMLElement>('[role="radio"]')[CHOICES.indexOf(next)]?.focus();
  }

  return (
    <div className={styles.choices} role="radiogroup" aria-label="同時に動かす数" ref={groupRef}>
      {CHOICES.map((choice, index) => (
        <button
          key={choice}
          type="button"
          role="radio"
          aria-checked={choice === selected}
          tabIndex={choice === selected ? 0 : -1}
          className={styles.choice}
          disabled={busy}
          onClick={() => {
            if (choice !== selected) onChoose(choice);
          }}
          onKeyDown={(event) => onKeyDown(event, index)}
        >
          {parallelChoiceLabel(choice, settings)}
        </button>
      ))}
    </div>
  );
}

/** 1〜5行目の本体 */
function Body({ inUse }: { inUse: number | null }) {
  const view = useParallelView();
  if (!view?.state || !view.settings) return null;
  const { state, settings, busy, error, choose } = view;
  return (
    <>
      <div className={styles.head}>
        <span className={styles.title}>同時に動かす</span>
        <span className={styles.badge} data-manual={state.override ? "" : undefined}>
          {parallelBadge(state)}
        </span>
      </div>
      <p className={styles.big}>
        <b className="num">{state.limit}</b>
        <span>件まで</span>
      </p>
      <Cells cells={parallelCells(inUse, settings, state)} />
      <p className={`${styles.usage} num`}>{describeParallelUsage(inUse, state, settings)}</p>
      <Choices busy={busy} onChoose={choose} />
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </>
  );
}

/**
 * 「同時に動かす」。PCの左のバーの下（`side`）とスマホのメニューの中（`menu`）は5行の全部。
 * `folded` は、マスと `1/1` だけの1行（左のバーを畳んだとき・スマホの上のバー）。押すと全部が開く。
 * docs/spec.md の「並列の状態と切り替え」・docs/design.md の「同時に動かす」
 */
export function ParallelSwitch({ variant }: { variant: "side" | "menu" | "folded" }) {
  const view = useParallelView();
  const inUse = useSlotsInUse();
  if (!view?.state || !view.settings) return null;
  if (variant === "folded") return <Folded inUse={inUse} />;
  return (
    <section className={`${styles.wrap} ${variant === "menu" ? styles.menu : styles.side}`} aria-label="同時に動かす">
      <Body inUse={inUse} />
    </section>
  );
}

/** 1行に縮めた形。押すと下に全部が開く（Esc・外を押すと閉じる） */
function Folded({ inUse }: { inUse: number | null }) {
  const view = useParallelView();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);
  if (!view?.state || !view.settings) return null;
  const { state, settings } = view;
  const description = describeParallelFolded(inUse, state);
  return (
    <div className={styles.folded} ref={rootRef}>
      <button
        type="button"
        className={styles.foldedButton}
        aria-expanded={open}
        aria-label={description}
        title={description}
        data-manual={state.override ? "" : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        <Cells cells={parallelCells(inUse, settings, state)} />
        <span className={`${styles.foldedCount} num`}>
          {inUse ?? "–"}/{state.limit}
        </span>
      </button>
      {open && (
        <div className={`${styles.wrap} ${styles.popover}`}>
          <Body inUse={inUse} />
        </div>
      )}
    </div>
  );
}
