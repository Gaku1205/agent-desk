"use client";

import { describeParallelBar, describeParallelButton } from "@/lib/parallel";
import { useParallelView } from "./ParallelContext";
import styles from "./ParallelToggle.module.css";

/**
 * 並列の今の状態（`並列3`・`夜：1件ずつ`）のボタン。PCの左のバーとスマホのメニューに置く。
 * 押すと今と反対（昼→夜／夜→昼）に切り替わり、上書き中に押すと時間帯の決まりに戻る。
 * docs/spec.md の「並列の状態と切り替え」・docs/design.md の「並列の状態のボタン」
 */
export function ParallelToggle({ variant }: { variant: "side" | "menu" }) {
  const view = useParallelView();
  if (!view?.state) return null;
  const { state, busy, error, toggle } = view;
  const description = describeParallelButton(state);
  return (
    <div className={`${styles.wrap} ${variant === "menu" ? styles.menu : styles.side}`}>
      <button
        type="button"
        className={styles.button}
        onClick={toggle}
        disabled={busy}
        aria-busy={busy}
        aria-label={`並列：${description}`}
        title={description}
        data-override={state.override ? "" : undefined}
        data-period={state.period}
      >
        <span className={`${styles.now} num`}>{describeParallelBar(state)}</span>
        {state.override && <span className={styles.manual}>手動</span>}
      </button>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
