"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { TurnItem } from "@/lib/turn";
import { ChevronIcon } from "./icons";
import { TurnList } from "./TurnList";
import styles from "./TurnSheet.module.css";

type Props = {
  items: TurnItem[];
  currentKey: string | null;
  now: Date;
  count: number;
  onPick: (key: string) => void;
};

/**
 * スマホのホーム：上の帯の `Your turn N ⌃` のボタンと、押すと下から出る一覧（docs/design.md の「ホーム：スマホ」）。
 * ボタンは TopBar の `#top-turn` に、一覧は body に重ねて出す。中身は右の列と同じ `TurnList`
 */
export function TurnSheet({ items, currentKey, now, count, onPick }: Props) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const paneRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    queueMicrotask(() => setSlot(document.getElementById("top-turn")));
  }, []);

  // 閉じたらボタンへフォーカスを戻す（行を選んで閉じるときは、Desk が選んだ1件へ移す）
  const close = useCallback(() => {
    setOpen(false);
    buttonRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (!open) return;
    paneRef.current?.querySelector<HTMLElement>('button[tabindex="0"]')?.focus({ preventScroll: true });
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      close();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, close]);

  return (
    <>
      {slot &&
        createPortal(
          <button
            type="button"
            ref={buttonRef}
            className={styles.button}
            aria-expanded={open}
            aria-controls="turn-sheet"
            aria-label={`Your turn ${count}件。一覧を${open ? "閉じる" : "開く"}`}
            onClick={() => (open ? close() : setOpen(true))}
          >
            <span aria-hidden="true">Your turn</span>
            <span className="num" aria-hidden="true">
              {count}
            </span>
            <span className={styles.caret} data-open={open ? "" : undefined} aria-hidden="true">
              <ChevronIcon size={14} />
            </span>
          </button>,
          slot,
        )}
      {createPortal(
        <div className={styles.sheet} data-open={open ? "" : undefined} aria-hidden={!open} inert={!open} id="turn-sheet">
          <div className={styles.scrim} onClick={close} aria-hidden="true" />
          <div className={styles.pane} role="dialog" aria-modal="true" aria-label="Your turn の全部" ref={paneRef}>
            <TurnList
              items={items}
              currentKey={currentKey}
              now={now}
              count={count}
              onPick={(key) => {
                setOpen(false);
                onPick(key);
              }}
            />
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
