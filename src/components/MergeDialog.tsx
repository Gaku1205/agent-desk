"use client";

import { useEffect, useRef, type KeyboardEvent, type SyntheticEvent } from "react";
import type { MergeSummary } from "@/lib/turn";
import styles from "./MergeDialog.module.css";

type Props = {
  repo: string;
  title: string;
  merge: MergeSummary;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

const REVIEW_LINE: Record<"clean" | "issues" | "none", string> = {
  clean: "✓ review  指摘なし",
  issues: "× review  指摘あり",
  none: "– review  未実施",
};

/** マージの確認ダイアログ（`Esc` でやめる、`Enter` でマージ。開いたときのフォーカスは「やめる」） */
export function MergeDialog({ repo, title, merge, pending, onCancel, onConfirm }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    cancelRef.current?.focus();
    return () => dialog.close();
  }, []);

  function handleCancel(event: SyntheticEvent<HTMLDialogElement>) {
    // Esc：ブラウザに閉じさせず、親の状態で閉じる
    event.preventDefault();
    if (!pending) onCancel();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (!pending) onConfirm();
  }

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby="merge-dialog-title"
      onCancel={handleCancel}
      onKeyDown={handleKeyDown}
    >
      <div className={styles.head}>
        <p className={`${styles.target} mono`}>
          {repo}・PR #{merge.pullNumber} → {merge.base}
        </p>
        <p className={styles.title} id="merge-dialog-title">
          『{title}』をマージしますか
        </p>
      </div>
      <pre className={`${styles.result} mono`}>
        {`✓ check   ${merge.ci.passed}/${merge.ci.total} 通過\n`}
        {`${REVIEW_LINE[merge.review ?? "none"]}\n`}
        {"→ deploy  マージ後にVercelが公開"}
      </pre>
      <div className={styles.buttons}>
        <button
          ref={cancelRef}
          type="button"
          className={styles.cancel}
          onClick={onCancel}
          disabled={pending}
        >
          やめる <kbd className="mono">Esc</kbd>
        </button>
        <button
          type="button"
          className={styles.confirm}
          onClick={onConfirm}
          disabled={pending}
        >
          マージする <kbd className="mono">⏎</kbd>
        </button>
      </div>
    </dialog>
  );
}
