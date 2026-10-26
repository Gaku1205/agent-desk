"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import styles from "./PipelineTable.module.css";

/** 流す速さ（px/秒） */
const SPEED = 60;

/**
 * パイプラインのタイトル。列に収まらず切れているときだけ、行に乗せた間に右から左へ流す（動きは PipelineTable.module.css）。
 * パイプライン表の行の外で使うときは、行に `marqueeHost` のクラスを付ける
 */
export function PipelineTitle({ title, className }: { title: string; className?: string }) {
  const boxRef = useRef<HTMLSpanElement>(null);
  const [overflow, setOverflow] = useState(0);

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const measure = () => setOverflow(Math.max(0, Math.ceil(box.scrollWidth - box.clientWidth)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, [title]);

  const style = {
    "--marquee-distance": `${overflow}px`,
    "--marquee-duration": `${(overflow / SPEED).toFixed(2)}s`,
  } as CSSProperties;

  return (
    <span
      className={className ? `${styles.title} ${className}` : styles.title}
      data-overflow={overflow > 0 ? "true" : undefined}
      title={overflow > 0 ? title : undefined}
      style={style}
      ref={boxRef}
    >
      <span className={styles.titleText}>{title}</span>
    </span>
  );
}
