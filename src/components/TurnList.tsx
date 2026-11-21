"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import { rovingNext } from "@/lib/roving";
import { formatWait, turnItemKey, type TurnItem } from "@/lib/turn";
import { groupLabel, turnHint, turnKind } from "@/lib/turnKind";
import styles from "./TurnList.module.css";

type Props = {
  /** 待っている物の全部（真ん中の1件も含む。並び順のまま） */
  items: TurnItem[];
  /** 今真ん中に出している物のキー */
  currentKey: string | null;
  now: Date;
  /** 件数（結果を出し始めた1件は数えない） */
  count: number;
  onPick: (key: string) => void;
  /** 読み上げの名前（スマホの下から出る一覧では、右の列と取り違えないよう別の名前にする） */
  label?: string;
};

/**
 * 右の Your turn の列（docs/design.md の「ホーム（決める画面）」）。待っている物を全部、並び順のまま縦に並べる。
 * 今真ん中に出している物は `いま`。行を選ぶと、その1件を真ん中に出す
 */
export function TurnList({ items, currentKey, now, count, onPick, label = "Your turn の全部" }: Props) {
  // Tab で止まる行（初めは今の1件）。矢印キーで動かす
  const [active, setActive] = useState<number | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const currentIndex = Math.max(
    items.findIndex((item) => turnItemKey(item) === currentKey),
    0,
  );
  const activeIndex = Math.min(active ?? currentIndex, Math.max(items.length - 1, 0));

  function onKeyDown(event: KeyboardEvent<HTMLUListElement>) {
    const next = rovingNext(event.key, activeIndex, items.length);
    if (next === null) return;
    event.preventDefault();
    setActive(next);
    listRef.current?.querySelectorAll<HTMLElement>("button")[next]?.focus();
  }

  return (
    <aside className={styles.list} aria-label={label}>
      <h2 className={styles.head}>
        <span>Your turn</span>
        <span className={`${styles.count} num`}>{count}</span>
      </h2>
      {items.length > 0 && (
        <ul className={styles.rows} ref={listRef} onKeyDown={onKeyDown}>
          {items.map((item, index) => {
            const key = turnItemKey(item);
            const kind = turnKind(item.status);
            const hint = turnHint(item.status.stage, item.question?.questions.length ?? 0);
            const here = key === currentKey;
            const wait = formatWait(item.waitingSince, now);
            const ref = item.pullOnly ? `${item.repo} PR #${item.issue.number}` : item.repo;
            return (
              <li key={key}>
                <button
                  type="button"
                  className={styles.row}
                  data-group={kind.group}
                  data-list-key={key}
                  data-here={here ? "" : undefined}
                  aria-current={here ? "true" : undefined}
                  tabIndex={index === activeIndex ? 0 : -1}
                  onFocus={() => setActive(index)}
                  onClick={() => onPick(key)}
                >
                  <span className={styles.kind}>
                    {here && <span className={styles.here}>いま · </span>}
                    <span className={styles.group}>{groupLabel(kind.group)}</span>
                    {hint && <span className={styles.hint}> · {hint}</span>}
                  </span>
                  <span className={styles.title}>{item.issue.title}</span>
                  <span className={`${styles.meta} num`}>
                    {ref} · {wait}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
