"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { isMotionReduced } from "@/lib/motion";
import { marqueeCycle, marqueeDistance, MARQUEE_EDGE, type MarqueeMode } from "@/lib/marquee";
import styles from "./Marquee.module.css";

type Props = {
  children: string;
  className?: string;
  /** 乗せた・フォーカスした・押して固定した間 true（PC。切れている行だけ流す） */
  active?: boolean;
  /** スマホ（`(hover: none)`）では、乗せられないので、画面に見えている間だけ自動で流す */
  autoInView?: boolean;
};

const HOVER_NONE = "(hover: none)";

function subscribeHoverNone(onChange: () => void): () => void {
  const query = window.matchMedia(HOVER_NONE);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function getHoverNone(): boolean {
  return window.matchMedia(HOVER_NONE).matches;
}

function getHoverNoneOnServer(): boolean {
  return false;
}

/** 左の端を消す幅が出るまでの時間（ms）。流れ出す瞬間に先頭の文字が欠けないように */
const LEFT_FADE_MS = 150;

/**
 * 1行で入らない文字を、電光掲示板のように横に流す部品（名札と出来事で共通。docs/design.md の「動き」）。
 * 入っている行は動かさない。動かすのは `transform: translateX` だけ。流れる文字は `aria-hidden`
 * （読み上げは、呼び出し側の `aria-label`・親の文字で足りる）。動きを減らすときは流さず、CSS で折り返す
 */
export function Marquee({ children, className, active = false, autoInView = false }: Props) {
  const viewRef = useRef<HTMLSpanElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  // 流す距離。0なら入っている（流さない）。幅が変わったら測り直す
  const [distance, setDistance] = useState(0);
  const [inView, setInView] = useState(false);
  const hoverNone = useSyncExternalStore(subscribeHoverNone, getHoverNone, getHoverNoneOnServer);

  useEffect(() => {
    const view = viewRef.current;
    const text = textRef.current;
    if (!view || !text) return;
    const measure = () => setDistance(marqueeDistance(text.getBoundingClientRect().width, view.clientWidth));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(view);
    return () => observer.disconnect();
  }, [children]);

  const watchView = autoInView && hoverNone;
  useEffect(() => {
    const view = viewRef.current;
    if (!watchView || !view) return;
    const observer = new IntersectionObserver((entries) => {
      const last = entries[entries.length - 1];
      if (last) setInView(last.isIntersecting);
    });
    observer.observe(view);
    return () => observer.disconnect();
  }, [watchView]);

  const play = watchView ? inView : active;
  const mode: MarqueeMode = watchView ? "view" : "hover";

  useEffect(() => {
    const view = viewRef.current;
    const text = textRef.current;
    if (!play || distance === 0 || !view || !text || typeof text.animate !== "function") return;
    const reduced = isMotionReduced(
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      document.documentElement.getAttribute("data-motion"),
    );
    if (reduced) return;

    const { duration, frames } = marqueeCycle(distance, mode);
    view.setAttribute("data-flow", "");
    const options: KeyframeAnimationOptions = { duration, iterations: Infinity, easing: "linear" };
    const move = text.animate(
      frames.map((f) => ({ offset: f.offset, transform: `translateX(${-f.shift}px)`, opacity: f.opacity })),
      options,
    );
    // 両端を消す幅のうち、左は流れ出してから出し、先頭へ戻るときに消す
    const startOffset = frames[1].offset;
    const backOffset = frames[5].offset;
    const edge = `${MARQUEE_EDGE}px`;
    const mask = view.animate(
      [
        { offset: 0, "--mq-left": "0px" },
        { offset: startOffset, "--mq-left": "0px" },
        { offset: Math.min(startOffset + LEFT_FADE_MS / duration, backOffset), "--mq-left": edge },
        { offset: backOffset, "--mq-left": edge },
        { offset: backOffset, "--mq-left": "0px" },
        { offset: 1, "--mq-left": "0px" },
      ],
      options,
    );
    return () => {
      move.cancel();
      mask.cancel();
      view.removeAttribute("data-flow");
    };
  }, [play, distance, mode]);

  return (
    <span ref={viewRef} className={`${styles.view} ${className ?? ""}`} aria-hidden="true">
      <span ref={textRef} className={styles.text}>
        {children}
      </span>
    </span>
  );
}
