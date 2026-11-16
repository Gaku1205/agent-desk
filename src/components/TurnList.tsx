"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import { rovingNext } from "@/lib/roving";
import { formatWait, turnItemKey, type TurnItem } from "@/lib/turn";
import { isTurnListFoldable } from "@/lib/turnList";
import { turnKind } from "@/lib/turnKind";
import styles from "./TurnList.module.css";

type Props = {
  /** 大きい1件を除いた残り（並び順のまま） */
  items: TurnItem[];
  now: Date;
  /** 複数のリポジトリを出しているとき、番号の前にリポジトリ名を付ける */
  showRepo: boolean;
  onPick: (key: string) => void;
};

/**
 * 「あなたの番」の残りの一覧（docs/design.md の「あなたの番」、docs/spec.md の「残りの一覧」）。
 * 1行を選ぶと、その1件が大きい方に替わる。6件以上は畳める
 */
export function TurnList({ items, now, showRepo, onPick }: Props) {
  const foldable = isTurnListFoldable(items.length);
  const [open, setOpen] = useState(false);
  // Tab で止まる行（初めは先頭）。矢印キーで動かす
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  if (items.length === 0) return null;
  const shown = !foldable || open;
  const activeIndex = Math.min(active, items.length - 1);

  function onKeyDown(event: KeyboardEvent<HTMLUListElement>) {
    const next = rovingNext(event.key, activeIndex, items.length);
    if (next === null) return;
    event.preventDefault();
    setActive(next);
    listRef.current?.querySelectorAll<HTMLElement>("button")[next]?.focus();
  }

  return (
    <div className={styles.list} role="group" aria-label="あなたの番の残り">
      {foldable && (
        <button
          type="button"
          className={styles.fold}
          aria-expanded={open}
          aria-controls="turn-list-rows"
          onClick={() => setOpen((prev) => !prev)}
        >
          <span>
            {open ? (
              "一覧を畳む"
            ) : (
              <>
                ほかの <span className="num">{items.length}</span>件を開く
              </>
            )}
          </span>
          <span className={styles.chev} aria-hidden="true" data-open={open ? "" : undefined} />
        </button>
      )}
      {shown && (
        <ul id="turn-list-rows" className={styles.rows} ref={listRef} onKeyDown={onKeyDown}>
          {items.map((item, index) => {
            const key = turnItemKey(item);
            const kind = turnKind(item.status);
            const ref = `${showRepo ? item.repo : ""}#${item.issue.number}`;
            const wait = formatWait(item.waitingSince, now);
            return (
              <li key={key}>
                <button
                  type="button"
                  className={styles.row}
                  data-tone={kind.tone}
                  data-list-key={key}
                  tabIndex={index === activeIndex ? 0 : -1}
                  onFocus={() => setActive(index)}
                  onClick={() => onPick(key)}
                >
                  <span className={styles.kind}>{kind.label}</span>
                  <span className={`${styles.ref} num`}>{ref}</span>
                  <span className={styles.title}>{item.issue.title}</span>
                  <span className={`${styles.wait} num`}>{wait}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
