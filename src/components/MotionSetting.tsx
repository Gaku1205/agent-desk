"use client";

import { useRef, useSyncExternalStore, type KeyboardEvent } from "react";
import { rovingNext } from "@/lib/roving";
import {
  MOTION_OPTIONS,
  applyMotion,
  getBrowserStorage,
  readMotion,
  writeMotion,
  type MotionSetting as Motion,
} from "@/lib/motion";
import settingsStyles from "./SettingsSections.module.css";
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
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next = rovingNext(event.key, index, MOTION_OPTIONS.length);
    if (next === null) return;
    event.preventDefault();
    choose(MOTION_OPTIONS[next].value);
    refs.current[next]?.focus();
  }

  return (
    <div className={styles.choices} role="radiogroup" aria-label="アニメーション">
      {MOTION_OPTIONS.map(({ value, label }, index) => (
        <button
          key={value}
          ref={(el) => {
            refs.current[index] = el;
          }}
          type="button"
          role="radio"
          aria-checked={current === value}
          tabIndex={current === value ? 0 : -1}
          onKeyDown={(event) => onKeyDown(event, index)}
          className={settingsStyles.toggle}
          onClick={() => choose(value)}
        >
          <span className={settingsStyles.lamp} aria-hidden="true" />
          {label}
        </button>
      ))}
    </div>
  );
}
