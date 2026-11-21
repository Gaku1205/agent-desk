import { formatStaleTime } from "@/lib/staleSnapshot";
import styles from "./LivePages.module.css";

export type StaleNoteProps = {
  staleAt?: string | null;
  staleBecause?: "loading" | "unreadable" | null;
  complete: boolean;
  /** まだ届いていないリポジトリの数。無ければ 0 */
  pendingRepos?: number;
};

/**
 * 古い結果を出している間の1行（日本時間）。新しい結果を待っている間は `HH:MM 時点の内容です。新しい内容を読んでいます…`、
 * 読めなかったので覚えている結果を出し続けているときは `HH:MM 時点の内容です。GitHubから読めなかったため、前に読めた内容を出しています`
 * （最後の段でも消えない）。まだ届いていないリポジトリがある間は、時刻ではなく `N件のリポジトリを読んでいます…`
 */
export function StaleNote({ staleAt, staleBecause, complete, pendingRepos = 0 }: StaleNoteProps) {
  // 時刻を出すと、全部が最新に見える。まだ全部ではないことを言う
  if (!complete && pendingRepos > 0) {
    return (
      <p className={styles.staleNote} role="status">
        {`${pendingRepos}件のリポジトリを読んでいます…`}
      </p>
    );
  }
  const unreadable = staleBecause === "unreadable";
  if ((complete && !unreadable) || !staleAt) return null;
  const time = formatStaleTime(staleAt);
  if (!time) return null;
  return (
    <p className={styles.staleNote} role="status">
      {unreadable
        ? `${time} 時点の内容です。GitHubから読めなかったため、前に読めた内容を出しています`
        : `${time} 時点の内容です。新しい内容を読んでいます…`}
    </p>
  );
}
