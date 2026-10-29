import type { CSSProperties } from "react";
import { PENDING_COLOR, toneRgba, type Progress, type ProgressBarSpec } from "@/lib/progress";
import styles from "./Ticks.module.css";

function barStyle(bar: ProgressBarSpec): CSSProperties {
  if (bar.tone === null) return { background: PENDING_COLOR };
  const color = toneRgba(bar.tone, bar.opacity);
  if (bar.outlineOnly) return { background: "transparent", boxShadow: `inset 0 0 0 1px ${color}` };
  return { background: color };
}

/** 進み具合の目盛り：8本の細い棒（docs/design.md の「進み具合の目盛り」）。色と不透明度は lib/progress.ts */
export function Ticks({ progress }: { progress: Progress }) {
  return (
    <span className={styles.ticks} role="img" aria-label={progress.ariaLabel}>
      {progress.bars.map((bar) => (
        <i className={styles.tk} style={barStyle(bar)} key={bar.index} />
      ))}
    </span>
  );
}
