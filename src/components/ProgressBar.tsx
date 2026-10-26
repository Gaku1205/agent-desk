import type { CSSProperties } from "react";
import { PENDING_COLOR, getProgress, toneRgba, type ProgressBarSpec } from "@/lib/progress";
import type { IssueStatus } from "@/lib/status";
import styles from "./ProgressBar.module.css";

/** 段階名の出し方：すべて（スマホでは今の段階だけ）／出さない／今の段階だけ */
export type ProgressLabels = "all" | "none" | "current";

/** 「今の段階だけ」は今の段階以外の名前を出さないので、「すべて」と同じ見た目の指定でよい */
const LABELS_CLASS: Record<ProgressLabels, string> = {
  all: styles.labeled,
  none: "",
  current: styles.labeled,
};

function barStyle(bar: ProgressBarSpec): CSSProperties {
  if (bar.tone === null) return { background: PENDING_COLOR };
  const color = toneRgba(bar.tone, bar.opacity);
  if (bar.outlineOnly) return { background: "transparent", boxShadow: `inset 0 0 0 1px ${color}` };
  return { background: color };
}

/** 進み具合のバー（8本の棒） */
export function ProgressBar({
  status,
  labels = "all",
}: {
  status: IssueStatus;
  labels?: ProgressLabels;
}) {
  const progress = getProgress(status);
  return (
    <div
      className={`${styles.progress} ${LABELS_CLASS[labels]}`}
      role="img"
      aria-label={progress.ariaLabel}
    >
      {progress.bars.map((bar) => (
        <div key={bar.index}>
          <span className={styles.bar} style={barStyle(bar)} />
          {(labels === "all" || (labels === "current" && bar.current)) && (
            <span className={styles.name} data-current={bar.current ? "true" : undefined}>
              {bar.name}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
