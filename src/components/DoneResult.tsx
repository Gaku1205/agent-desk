import type { Ref } from "react";
import type { DoneSummary } from "@/lib/operationResult";
import { CheckIcon } from "./icons";
import { SmartLink } from "./SmartLink";
import styles from "./DoneResult.module.css";

type Props = {
  summary: DoneSummary;
  /** マージ待ちの一覧の行（小さい文字） */
  compact?: boolean;
  onClose: () => void;
  closeRef?: Ref<HTMLButtonElement>;
};

/**
 * 押したあとの結果の1行（docs/design.md の「押したあとの結果」）：緑のチェックと `〜しました`、
 * マージなら `PR #番号 ↗` と `#12 が動き出します`、右端に `閉じる`
 */
export function DoneResult({ summary, compact = false, onClose, closeRef }: Props) {
  return (
    <div className={styles.done} data-compact={compact ? "" : undefined}>
      <p className={styles.head} role="status">
        <span className={styles.mark} aria-hidden="true">
          <CheckIcon size={compact ? 14 : 18} />
        </span>
        <span className={styles.title}>{summary.title}</span>
      </p>
      {summary.pull && (
        <SmartLink className={`${styles.pull} num`} href={summary.pull.url}>
          {`PR #${summary.pull.number} ↗`}
        </SmartLink>
      )}
      {summary.starts && <span className={styles.starts}>{summary.starts}</span>}
      <button ref={closeRef} type="button" className={styles.close} data-act="" onClick={onClose}>
        閉じる
      </button>
    </div>
  );
}
