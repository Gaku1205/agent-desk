"use client";

import { useEffect, useRef, useState } from "react";
import { lampLabel, type Lamp } from "@/lib/lamp";
import styles from "./Conversation.module.css";

/** 長押しとみなすまでの時間と、出した文言を消すまでの時間 */
const LONG_PRESS_MS = 450;
const TIP_MS = 2000;

/**
 * 「いまの様子」の行の左のランプ（docs/design.md の「ランプ」）。
 * 緑の丸（脈打つ）・赤の丸・紫の数字。読み上げの名前とホバーの文言（`title`）、長押しで同じ文言を出す
 */
export function LampMark({ lamp }: { lamp: Lamp }) {
  const label = lampLabel(lamp);
  const [tip, setTip] = useState(false);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (pressTimer.current) clearTimeout(pressTimer.current);
      if (hideTimer.current) clearTimeout(hideTimer.current);
    },
    [],
  );

  if (label === null) return null;

  function cancelPress() {
    if (pressTimer.current) clearTimeout(pressTimer.current);
    pressTimer.current = null;
  }

  function startPress(event: React.PointerEvent) {
    // マウスはホバーの title で出るので、長押しはタッチ・ペンだけ
    if (event.pointerType === "mouse") return;
    cancelPress();
    pressTimer.current = setTimeout(() => {
      setTip(true);
      if (hideTimer.current) clearTimeout(hideTimer.current);
      hideTimer.current = setTimeout(() => setTip(false), TIP_MS);
    }, LONG_PRESS_MS);
  }

  return (
    <span
      className={styles.lamp}
      data-kind={lamp.kind}
      role="img"
      aria-label={label}
      title={label}
      onPointerDown={startPress}
      onPointerUp={cancelPress}
      onPointerCancel={cancelPress}
      onPointerLeave={cancelPress}
      onContextMenu={(event) => event.preventDefault()}
    >
      {lamp.kind === "waiting" ? (
        <span className={`${styles.lampNum} num`} aria-hidden="true">
          {lamp.position}
        </span>
      ) : (
        <span className={styles.lampDot} aria-hidden="true" />
      )}
      {tip && (
        <span className={styles.lampTip} aria-hidden="true">
          {label}
        </span>
      )}
    </span>
  );
}
