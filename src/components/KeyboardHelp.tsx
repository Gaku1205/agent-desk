"use client";

import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { isHelpToggleKey } from "@/lib/keyboardHelp";
import styles from "./KeyboardHelp.module.css";

/** 一覧に載せるのは、いま実際にある操作だけ（docs/spec.md の「キーボード操作の一覧」） */
const ROWS: { keys: string[]; text: string }[] = [
  { keys: ["?"], text: "この一覧を開く・閉じる" },
  { keys: ["Tab"], text: "最初の Tab で「本文へ移る」。押すと、あなたの番の最初のボタンへ移る" },
  { keys: ["←", "→", "↑", "↓"], text: "流れの名札の間を動く" },
  { keys: ["Home", "End"], text: "流れの先頭・末尾の名札へ動く" },
  { keys: ["Enter", "Space"], text: "流れの名札を押す" },
  { keys: ["Esc"], text: "スマホのメニュー・マージの確認を閉じる" },
];

/**
 * `?` で開くキーボード操作の一覧（ダイアログ）。`Esc`・閉じるボタン・外側・もう一度 `?` で閉じる。
 * 開いたら閉じるボタンへフォーカスを移し、閉じたら開く前の場所へ戻す
 */
export function KeyboardHelp() {
  const [open, setOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const returnRef = useRef<HTMLElement | null>(null);

  const close = useCallback(() => setOpen(false), []);

  // `?` で開閉（AppShell の useMenuState の Esc と同じく window の keydown）
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target instanceof HTMLElement ? event.target : null;
      const { key, ctrlKey, altKey, metaKey, isComposing, repeat } = event;
      if (!isHelpToggleKey({ key, ctrlKey, altKey, metaKey, isComposing, repeat, target })) return;
      if (!open) returnRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setOpen(!open);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  // 開いている間：Esc でこの一覧だけを閉じ（メニュー・確認には届かせない）、Tab で後ろの画面へ出さない
  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
      } else if (event.key === "Tab") {
        event.preventDefault();
        closeRef.current?.focus();
      }
    }
    // 先に受けて、window の後ろの受け手（メニューの Esc）へ渡さない
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      const back = returnRef.current;
      returnRef.current = null;
      if (back?.isConnected) back.focus();
    };
  }, [open]);

  if (!open) return null;

  function onScrimClick(event: MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) close();
  }

  return (
    <div className={styles.scrim} onClick={onScrimClick}>
      <div className={styles.panel} role="dialog" aria-modal="true" aria-label="キーボード操作の一覧">
        <div className={styles.head}>
          <h2 className={styles.title}>キーボード操作</h2>
          <button type="button" className={styles.close} onClick={close} ref={closeRef}>
            閉じる
          </button>
        </div>
        <ul className={styles.list}>
          {ROWS.map((row) => (
            <li key={row.keys.join(" ")} className={styles.row}>
              <span className={styles.keys}>
                {row.keys.map((k) => (
                  <kbd key={k} className={styles.key}>
                    {k}
                  </kbd>
                ))}
              </span>
              <span className={styles.text}>{row.text}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
