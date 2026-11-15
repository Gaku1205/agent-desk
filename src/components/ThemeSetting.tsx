"use client";

import { useRef, useSyncExternalStore, type KeyboardEvent } from "react";
import { rovingNext } from "@/lib/roving";
import { getBrowserStorage } from "@/lib/motion";
import {
  THEME_OPTIONS,
  applyTheme,
  readTheme,
  writeTheme,
  type ThemeSetting as Theme,
} from "@/lib/theme";
import settingsStyles from "./SettingsSections.module.css";
import styles from "./MotionSetting.module.css";

const listeners = new Set<() => void>();
// localStorage が使えないときも、このタブの間は選んだ内容を覚えておく
let memory: Theme | null = null;

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function getSnapshot(): Theme {
  return memory ?? readTheme(getBrowserStorage());
}

function getServerSnapshot(): Theme {
  return "system";
}

function choose(setting: Theme) {
  memory = setting;
  writeTheme(getBrowserStorage(), setting);
  applyTheme(setting, document.documentElement);
  listeners.forEach((listener) => listener());
}

/** 「テーマ」の切り替え（OSに合わせる／白／黒）。選んだらすぐ反映する（保存ボタンなし） */
export function ThemeSetting() {
  const current = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next = rovingNext(event.key, index, THEME_OPTIONS.length);
    if (next === null) return;
    event.preventDefault();
    choose(THEME_OPTIONS[next].value);
    refs.current[next]?.focus();
  }

  return (
    <div className={styles.choices} role="radiogroup" aria-label="テーマ">
      {THEME_OPTIONS.map(({ value, label }, index) => (
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
