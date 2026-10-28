import type { WatchdogNotice } from "@/lib/watchdogState";
import styles from "./WatchdogNotices.module.css";

type Props = {
  notices: WatchdogNotice[];
  /** ホームではリポジトリ名を文の前に付ける */
  showRepo: boolean;
};

/** 見張り役（watchdog.yml）が止まっているリポジトリの注意。無ければ場所ごと出さない */
export function WatchdogNotices({ notices, showRepo }: Props) {
  if (notices.length === 0) return null;
  return (
    <ul className={styles.list} role="status">
      {notices.map((notice) => (
        <li className={styles.item} key={`${notice.owner}/${notice.repo}`}>
          <svg
            className={styles.icon}
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            stroke="var(--human)"
            strokeWidth="1.5"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <circle cx="7" cy="7" r="5.5" />
            <path d="M7 4.2v3.2M7 9.6v.01" />
          </svg>
          <span className={styles.text}>
            {showRepo ? (
              <span className={`${styles.repo} mono`}>
                {notice.owner}/{notice.repo}
              </span>
            ) : null}
            見張り役が {notice.hours} 時間動いていません。Actions が止まっていないか確認してください
          </span>
        </li>
      ))}
    </ul>
  );
}
