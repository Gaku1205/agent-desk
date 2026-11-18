"use client";

import { formatSpan } from "@/lib/dashboard/duration";
import { buildUsageChart, usageSummary, type UsageSource } from "@/lib/lanes/usage";
import type { ParallelSettings } from "@/lib/parallel";
import styles from "./LanesUsage.module.css";

type Props = {
  /** サーバーで作った材料（取れなければ null） */
  usage: UsageSource | null;
  /** 並列の設定（読めなければ null。上限の段と夜の帯は出さない） */
  settings: ParallelSettings | null;
  /** 区画の見出しの id */
  headingId: string;
};

/** グラフの中の座標（横いっぱいに引き伸ばす。線の太さは変えない） */
const W = 960;
const H = 100;

/** 値の並びを「段」の折れ線にする（各段の間は横線、段の変わり目は縦線） */
function stepPath(values: readonly number[], yMax: number, closeToBottom: boolean): string {
  const step = W / values.length;
  const y = (value: number) => H - (value / yMax) * H;
  let d = closeToBottom ? `M0 ${H}` : `M0 ${y(values[0])}`;
  values.forEach((value, index) => {
    d += ` L${index * step} ${y(value)} L${(index + 1) * step} ${y(value)}`;
  });
  if (closeToBottom) d += ` L${W} ${H} Z`;
  return d;
}

/** 夜の時間帯の上限の文：`1件ずつ`・`2件まで` */
function nightText(n: number): string {
  return n === 1 ? "1件ずつ" : `${n}件まで`;
}

/** Last 24h：使っていた枠・枠の上限・順番待ちの数の線グラフと、下の1行 */
export function LanesUsage({ usage, settings, headingId }: Props) {
  if (usage === null) {
    return <p className={styles.empty}>この24時間の記録はありません</p>;
  }
  const chart = buildUsageChart(usage, settings);
  const count = chart.buckets.length;
  const pct = (index: number) => `${(index / count) * 100}%`;
  const top = (value: number) => `${100 - (value / chart.yMax) * 100}%`;
  const used = chart.maxUsed === null ? null : chart.buckets.map((bucket) => bucket.used ?? 0);
  const limits = chart.limits === null ? null : chart.buckets.map((bucket) => bucket.limit ?? 0);
  const queued = chart.buckets.map((bucket) => bucket.queued);
  const summary = usageSummary(chart, formatSpan);
  const yLabels = chart.yTicks;
  const peak = chart.peak;
  const firstNight = chart.nightSpans[0];

  return (
    <figure className={styles.figure} aria-labelledby={headingId}>
      <div className={styles.chart}>
        <div className={styles.yAxis} aria-hidden="true">
          {yLabels.map((value) => (
            <span key={value} className={`${styles.yLabel} num`} style={{ top: top(value) }}>
              {value}
            </span>
          ))}
        </div>
        <div className={styles.plot}>
          {chart.nightSpans.map((span) => (
            <span
              key={span.from}
              className={styles.night}
              style={{ left: pct(span.from), width: `${((span.to - span.from) / count) * 100}%` }}
              aria-hidden="true"
            />
          ))}
          {yLabels.map((value) => (
            <span key={value} className={styles.grid} style={{ top: top(value) }} aria-hidden="true" />
          ))}
          <svg
            className={styles.svg}
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            role="img"
            aria-label={`直近24時間の枠の使われ方。${summary}`}
          >
            {used && (
              <>
                <path className={styles.usedFill} d={stepPath(used, chart.yMax, true)} />
                <path className={styles.usedLine} d={stepPath(used, chart.yMax, false)} />
              </>
            )}
            {limits && <path className={styles.limitLine} d={stepPath(limits, chart.yMax, false)} />}
            <path className={styles.queueLine} d={stepPath(queued, chart.yMax, false)} />
          </svg>
          {firstNight && chart.limits?.night != null && (
            <span className={styles.nightLabel} style={{ left: pct(firstNight.from) }}>
              Night · {nightText(chart.limits.night)}
            </span>
          )}
          {peak && (
            <span
              className={styles.peak}
              data-side={(peak.index + 0.5) / count > 0.8 ? "left" : "right"}
              style={{ left: pct(peak.index + 0.5), top: top(peak.value) }}
            >
              <span className={styles.peakDot} aria-hidden="true" />
              <span className={`${styles.peakText} num`}>Queue {peak.value}</span>
            </span>
          )}
        </div>
        <div className={styles.xAxis} aria-hidden="true">
          {chart.ticks.map((tick) => (
            <span key={tick.index} className={`${styles.xLabel} num`} style={{ left: pct(tick.index) }}>
              {tick.label}
            </span>
          ))}
        </div>
      </div>
      <ul className={styles.legend}>
        {used && (
          <li>
            <span className={styles.keyUsed} aria-hidden="true" />
            使っていた枠
          </li>
        )}
        {limits && (
          <li>
            <span className={styles.keyLimit} aria-hidden="true" />
            枠の上限
            {chart.limits && (
              <span className={`${styles.legendSub} num`}>
                昼{chart.limits.day}
                {chart.limits.night !== null && ` · 夜${chart.limits.night}`}
              </span>
            )}
          </li>
        )}
        <li>
          <span className={styles.keyQueue} aria-hidden="true" />
          順番待ち
        </li>
      </ul>
      <figcaption className={`${styles.summary} num`}>{summary}</figcaption>
    </figure>
  );
}
