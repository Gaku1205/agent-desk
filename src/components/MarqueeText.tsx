"use client";

import { useEffect, useRef, useState } from "react";
import { isMotionReduced } from "@/lib/motion";
import { createLongPress, isOverflowing, marqueeDistance, marqueeTiming } from "@/lib/marquee";
import styles from "./MarqueeText.module.css";

type Props = {
  text: string;
  /** 切る行数（初めは1行。ホームの右の列は2行） */
  lines?: 1 | 2;
};

/** 長押しの間に指が動いたら、長押しをやめる距離（px） */
const MOVE_LIMIT = 10;

/**
 * 長い題名を、触れた行だけ電光掲示板のように流す（docs/design.md の「長い題名を流す（触れた行だけ）」）。
 * 行は、親をたどって最初の `[data-marquee-row]`（無ければこの部品の箱）。マウスを乗せる・長押し・キーボードのフォーカスの間だけ流れ、
 * 離すと最初に戻る。動きを減らす設定では流さず、触れている間だけ折り返して全部出す。切れていない題名は動かさない
 */
export function MarqueeText({ text, lines = 1 }: Props) {
  const boxRef = useRef<HTMLSpanElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [mode, setMode] = useState<"idle" | "marquee" | "wrap">("idle");

  // 触れている間の見た目：流す、または折り返す
  useEffect(() => {
    const box = boxRef.current;
    const el = textRef.current;
    if (!box || !el || mode !== "marquee") return;
    const timing = marqueeTiming(marqueeDistance(el.scrollWidth, box.clientWidth));
    if (!timing || typeof el.animate !== "function") return;
    const distance = marqueeDistance(el.scrollWidth, box.clientWidth);
    const animation = el.animate(
      [
        { transform: "translateX(0)", offset: 0 },
        { transform: "translateX(0)", offset: timing.startOffset },
        { transform: `translateX(${-distance}px)`, offset: timing.endOffset },
        { transform: `translateX(${-distance}px)`, offset: 1 },
      ],
      { duration: timing.durationMs, iterations: Infinity, easing: "linear" },
    );
    // 離したら cancel で最初の位置に戻る
    return () => animation.cancel();
  }, [mode]);

  useEffect(() => {
    const box = boxRef.current;
    const el = textRef.current;
    if (!box || !el) return;
    const boxEl: HTMLElement = box;
    const row = boxEl.closest<HTMLElement>("[data-marquee-row]") ?? boxEl;
    const touching = { current: false };
    const flags = { hover: false, focus: false, press: false };
    let playing = false;
    let origin: { x: number; y: number } | null = null;

    function cut(): boolean {
      if (!el) return false;
      return lines > 1
        ? isOverflowing(el.scrollHeight, el.clientHeight)
        : isOverflowing(el.scrollWidth, el.clientWidth);
    }

    function sync() {
      const wanted = flags.hover || flags.focus || flags.press;
      if (wanted === playing) return;
      if (!wanted) {
        playing = false;
        boxEl.style.minHeight = "";
        setMode("idle");
        return;
      }
      // 切れている題名だけ動かす
      if (!cut()) return;
      playing = true;
      const reduced = isMotionReduced(
        window.matchMedia("(prefers-reduced-motion: reduce)").matches,
        document.documentElement.getAttribute("data-motion"),
      );
      // 流している間も、行の高さは触れる前のまま保つ（折り返すときは全部出すので保たない）
      if (!reduced) boxEl.style.minHeight = `${boxEl.offsetHeight}px`;
      setMode(reduced ? "wrap" : "marquee");
    }

    const press = createLongPress({
      onLong: () => {
        flags.press = true;
        sync();
      },
    });

    function onPointerEnter(event: PointerEvent) {
      if (event.pointerType === "touch") return;
      flags.hover = true;
      sync();
    }
    function onPointerLeave(event: PointerEvent) {
      if (event.pointerType === "touch") return;
      flags.hover = false;
      sync();
    }
    function onPointerDown(event: PointerEvent) {
      touching.current = event.pointerType === "touch";
      if (!touching.current) return;
      // 題名と別のリンクやボタン（ログ・操作のボタン）の上では長押しにしない
      const target = event.target instanceof Element ? event.target.closest("a, button") : null;
      if (target && !target.contains(boxEl)) return;
      origin = { x: event.clientX, y: event.clientY };
      press.start();
    }
    function onPointerMove(event: PointerEvent) {
      if (!origin || flags.press) return;
      if (Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > MOVE_LIMIT) {
        origin = null;
        press.cancel();
      }
    }
    function onPointerEnd() {
      origin = null;
      press.end();
      flags.press = false;
      sync();
    }
    function onClick(event: MouseEvent) {
      if (!press.consumeClick()) return;
      event.preventDefault();
      event.stopPropagation();
    }
    function onContextMenu(event: Event) {
      if (touching.current) event.preventDefault();
    }
    function onFocusIn(event: FocusEvent) {
      let visible = false;
      try {
        visible = event.target instanceof Element && event.target.matches(":focus-visible");
      } catch {
        visible = false;
      }
      if (!visible) return;
      flags.focus = true;
      sync();
    }
    function onFocusOut(event: FocusEvent) {
      if (event.relatedTarget instanceof Node && row.contains(event.relatedTarget)) return;
      flags.focus = false;
      sync();
    }

    row.addEventListener("pointerenter", onPointerEnter);
    row.addEventListener("pointerleave", onPointerLeave);
    row.addEventListener("pointerdown", onPointerDown);
    row.addEventListener("pointermove", onPointerMove);
    row.addEventListener("pointerup", onPointerEnd);
    row.addEventListener("pointercancel", onPointerEnd);
    row.addEventListener("click", onClick, true);
    row.addEventListener("contextmenu", onContextMenu);
    row.addEventListener("focusin", onFocusIn);
    row.addEventListener("focusout", onFocusOut);
    return () => {
      press.cancel();
      row.removeEventListener("pointerenter", onPointerEnter);
      row.removeEventListener("pointerleave", onPointerLeave);
      row.removeEventListener("pointerdown", onPointerDown);
      row.removeEventListener("pointermove", onPointerMove);
      row.removeEventListener("pointerup", onPointerEnd);
      row.removeEventListener("pointercancel", onPointerEnd);
      row.removeEventListener("click", onClick, true);
      row.removeEventListener("contextmenu", onContextMenu);
      row.removeEventListener("focusin", onFocusIn);
      row.removeEventListener("focusout", onFocusOut);
    };
  }, [lines]);

  return (
    <span ref={boxRef} className={styles.box} data-lines={lines > 1 ? String(lines) : undefined}>
      <span ref={textRef} className={styles.text} data-mode={mode}>
        {text}
      </span>
    </span>
  );
}
