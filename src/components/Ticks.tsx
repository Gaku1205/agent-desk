import type { CSSProperties } from "react";
import { calmRgba, PENDING_COLOR, toneRgba, type Progress, type ProgressBarSpec } from "@/lib/progress";
import styles from "./Ticks.module.css";

function barStyle(bar: ProgressBarSpec, calm: boolean): CSSProperties {
  if (bar.tone === null) return { background: PENDING_COLOR };
  // 静かな色：止まった・公開失敗以外の行では、誰の番かの色を使わず --bone で塗る（濃さの変わり方は同じ）
  const color = calm ? calmRgba(bar.opacity) : toneRgba(bar.tone, bar.opacity);
  if (bar.outlineOnly) return { background: "transparent", boxShadow: `inset 0 0 0 1px ${color}` };
  return { background: color };
}

/**
 * 進み具合の目盛り：8本の細い棒（docs/design.md の「進み具合の目盛り」）。色と不透明度は lib/progress.ts。
 * calm：誰の番かの色を使わず、静かな色で塗る
 */
export function Ticks({ progress, calm = false }: { progress: Progress; calm?: boolean }) {
  return (
    <span className={styles.ticks} role="img" aria-label={progress.ariaLabel}>
      {progress.bars.map((bar) => (
        <i className={styles.tk} style={barStyle(bar, calm)} key={bar.index} />
      ))}
    </span>
  );
}
