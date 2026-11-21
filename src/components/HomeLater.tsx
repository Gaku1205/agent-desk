"use client";

import Link from "next/link";
import { turnItemKey, type TurnItem } from "@/lib/turn";
import { groupLabel, turnKind } from "@/lib/turnKind";
import type { HomeActivity } from "@/lib/lanes/source";
import styles from "./HomeLater.module.css";
import { TurnKindIcon } from "./TurnKindIcon";

type Props = {
  /** 真ん中の1件を除いた、残りの物（並び順のまま） */
  items: TurnItem[];
  onPick: (key: string) => void;
  activity: HomeActivity | null;
  base: string;
};

/** スマホのホーム：1件の下の `このあと` の一覧と、いちばん下の動いている作業の1行（docs/design.md の「ホーム：スマホ」。PC では出さない） */
export function HomeLater({ items, onPick, activity, base }: Props) {
  return (
    <div className={styles.later}>
      {items.length > 0 && (
        <section aria-labelledby="later-title">
          <h2 className={styles.head} id="later-title">
            このあと
          </h2>
          <ul className={styles.rows}>
            {items.map((item) => {
              const key = turnItemKey(item);
              const kind = turnKind(item.status);
              return (
                <li key={key}>
                  <button type="button" className={styles.row} data-group={kind.group} onClick={() => onPick(key)}>
                    <span className={styles.kind}>
                      <TurnKindIcon icon={kind.icon} />
                      {groupLabel(kind.group)}
                    </span>
                    <span className={styles.title}>{item.issue.title}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {activity && (
        <Link
          href={`${base}/lanes`}
          className={`${styles.activity} num`}
          aria-label={`実装中 ${activity.running}、順番待ち ${activity.queued}。Slots & Queue を開く`}
        >
          <span className={styles.dot} aria-hidden="true" />
          実装中 {activity.running} · 順番待ち {activity.queued} →
        </Link>
      )}
    </div>
  );
}
