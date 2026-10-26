"use client";

import { useSyncExternalStore } from "react";
import {
  MOTION_OPTIONS,
  applyMotion,
  getBrowserStorage,
  readMotion,
  writeMotion,
  type MotionSetting as Motion,
} from "@/lib/motion";
import styles from "./MotionSetting.module.css";

const listeners = new Set<() => void>();
// localStorage が使えないときも、このタブの間は選んだ内容を覚えておく
let memory: Motion | null = null;

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function getSnapshot(): Motion {
  return memory ?? readMotion(getBrowserStorage());
}

function getServerSnapshot(): Motion {
  return "system";
}

function choose(setting: Motion) {
  memory = setting;
  writeMotion(getBrowserStorage(), setting);
  applyMotion(setting, document.documentElement);
  listeners.forEach((listener) => listener());
}

/** 「アニメーション」の切り替え。選んだらすぐ反映する（保存ボタンなし） */
export function MotionSetting() {
  const current = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  return (
    <div className={styles.segmented} role="radiogroup" aria-label="アニメーション">
      {MOTION_OPTIONS.map(({ value, label }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={current === value}
          className={styles.option}
          onClick={() => choose(value)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
