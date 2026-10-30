"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type Ref } from "react";
import { typeahead, type TypeaheadState } from "@/lib/typeahead";
import styles from "./Select.module.css";

type Props = {
  options: string[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  /** 読み上げ用の名前 */
  label: string;
  /** 選べる物が無いときに出す字 */
  emptyText?: string;
  /** 閉じているときの押せる箱（フォーカスを移すため） */
  buttonRef?: Ref<HTMLButtonElement>;
};

/**
 * 選択欄（標準の `<select>` は使わない。docs/design.md の「設定」）。
 * 押す・Enter・Space・↓ で開き、↑↓ で動かし、文字を打てばその文字で始まる候補へ移り、Enter で選ぶ、Esc で閉じる。外を押しても閉じる
 */
export function Select({ options, value, onChange, disabled, label, emptyText, buttonRef }: Props) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(() => Math.max(0, options.indexOf(value)));
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const id = useId();
  const typed = useRef<TypeaheadState>({ text: "", at: 0 });

  useEffect(() => {
    if (!open) return;
    function onDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    listRef.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  function show() {
    setActive(Math.max(0, options.indexOf(value)));
    setOpen(true);
  }

  function choose(index: number) {
    const next = options[index];
    if (next !== undefined && next !== value) onChange(next);
    setOpen(false);
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (disabled || options.length === 0) return;
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        if (!open) show();
        else setActive((i) => Math.min(options.length - 1, i + 1));
        break;
      case "ArrowUp":
        event.preventDefault();
        if (!open) show();
        else setActive((i) => Math.max(0, i - 1));
        break;
      case "Home":
        if (open) {
          event.preventDefault();
          setActive(0);
        }
        break;
      case "End":
        if (open) {
          event.preventDefault();
          setActive(options.length - 1);
        }
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        if (open) choose(active);
        else show();
        break;
      case "Escape":
        if (open) {
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
        }
        break;
      case "Tab":
        setOpen(false);
        break;
      default: {
        if (event.ctrlKey || event.metaKey || event.altKey) break;
        const result = typeahead(typed.current, event.key, Date.now(), options);
        typed.current = result.state;
        if (result.index === null) break;
        event.preventDefault();
        if (!open) setOpen(true);
        setActive(result.index);
      }
    }
  }

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        type="button"
        ref={buttonRef}
        className={styles.button}
        role="combobox"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-activedescendant={open ? `${id}-${active}` : undefined}
        disabled={disabled || options.length === 0}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onKeyDown}
      >
        <span className={styles.value}>{value || emptyText || "（選べる物がありません）"}</span>
        <span className={styles.caret} aria-hidden="true">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
            <path d="M2 3.5h6L5 7z" />
          </svg>
        </span>
      </button>
      {open && (
        <ul className={styles.list} role="listbox" id={`${id}-list`} ref={listRef} aria-label={label}>
          {options.map((option, index) => (
            <li
              key={option}
              id={`${id}-${index}`}
              role="option"
              aria-selected={option === value}
              data-active={index === active ? "" : undefined}
              className={styles.option}
              onPointerMove={() => setActive(index)}
              onClick={() => choose(index)}
            >
              {option}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
