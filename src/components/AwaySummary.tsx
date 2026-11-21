"use client";

import Link from "next/link";
import { clockTime } from "@/lib/pastLog";
import type { AwaySummary as Summary } from "@/lib/awaySummary";
import styles from "./AwaySummary.module.css";

/** ホームの「いない間のまとめ」の面（docs/design.md の「いない間のまとめ」） */
export function AwaySummary({
  summary,
  lastSeen,
  now,
  dashboardHref,
  onDismiss,
}: {
  summary: Summary;
  /** 前に見た時刻（ISO） */
  lastSeen: string;
  now: Date;
  dashboardHref: string;
  onDismiss: () => void;
}) {
  const counts: React.ReactNode[] = [];
  if (summary.deployed > 0) {
    counts.push(
      <span key="d">
        <span className={styles.ok} aria-hidden="true">✓</span> 公開 {summary.deployed}件
      </span>,
    );
  }
  if (summary.stuck > 0) {
    counts.push(
      <span key="s">
        <span className={styles.fail} aria-hidden="true">×</span> 止まり {summary.stuck}
        {summary.stuckRecovered ? "（自動で直った）" : ""}
      </span>,
    );
  }
  if (summary.questions > 0) {
    counts.push(
      <span key="q">
        <span className={styles.attention} aria-hidden="true">?</span> 新しい質問 {summary.questions}
      </span>,
    );
  }
  return (
    <section className={styles.panel} aria-label="いない間のまとめ">
      <p className={`${styles.head} num`}>
        {summary.hours}時間ぶり {clockTime(lastSeen)} → {clockTime(now.toISOString())}
      </p>
      <button type="button" className={styles.close} aria-label="いない間のまとめを閉じる" onClick={onDismiss}>
        ×
      </button>
      <p className={`${styles.counts} num`}>
        {counts.map((node, i) => (
          <span key={i}>
            {i > 0 && " · "}
            {node}
          </span>
        ))}
      </p>
      {summary.titles.length > 0 && (
        <p className={styles.titles}>
          <Link href={dashboardHref} onClick={onDismiss} className={styles.link}>
            <span className={styles.titleText}>{summary.titles.join(" · ")}</span>
            {summary.more > 0 && <span className={`${styles.more} num`}> · ほか {summary.more} →</span>}
          </Link>
        </p>
      )}
    </section>
  );
}
