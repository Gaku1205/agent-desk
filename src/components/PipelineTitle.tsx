"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";

/** 流す速さ（px/秒） */
const SPEED = 60;

/** パイプラインのタイトル。列に収まらず切れているときだけ、行に乗せた間に右から左へ流す（動きは globals.css） */
export function PipelineTitle({ title }: { title: string }) {
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
      className="pipeline-title"
      data-overflow={overflow > 0 ? "true" : undefined}
      title={overflow > 0 ? title : undefined}
      style={style}
      ref={boxRef}
    >
      <span className="pipeline-title-text">{title}</span>
    </span>
  );
}
