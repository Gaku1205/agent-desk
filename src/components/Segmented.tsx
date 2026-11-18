"use client";

import { useRef, type KeyboardEvent } from "react";
import { rovingNext } from "@/lib/roving";
import styles from "./Settings.module.css";

type Props<T extends string> = {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  /** 読み上げの名前 */
  label: string;
};

/**
 * 切り替えボタン（`role="radiogroup"`）。Tab で止まるのは選ばれている1つだけで、
 * ←→・↑↓ で隣へフォーカスと選択を同時に移す（端では反対の端へ回る）
 */
export function Segmented<T extends string>({ options, value, onChange, label }: Props<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next = rovingNext(event.key, index, options.length);
    if (next === null) return;
    event.preventDefault();
    onChange(options[next].value);
    refs.current[next]?.focus();
  }

  return (
    <div className={styles.segmented} role="radiogroup" aria-label={label}>
      {options.map((option, index) => (
        <button
          key={option.value}
          ref={(el) => {
            refs.current[index] = el;
          }}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          tabIndex={option.value === value ? 0 : -1}
          className={styles.segment}
          onKeyDown={(event) => onKeyDown(event, index)}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
