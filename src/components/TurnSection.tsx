import type { RepoResult } from "@/lib/github/types";
import { formatWait, type TurnItem } from "@/lib/turn";
import { ProgressBar } from "./ProgressBar";
import { TurnRow } from "./TurnRow";
import styles from "./TurnSection.module.css";

type Props = {
  items: TurnItem[];
  /** 取れなかったリポジトリ（理由を出す） */
  errors: RepoResult[];
  now: Date;
  /** ホームでは「全リポジトリ・待ちが長い順」 */
  scope: "all" | "repo";
};

/** あなたの番（人間の判断待ちだけ、止まった物が上・待ちが長い順） */
export function TurnSection({ items, errors, now, scope }: Props) {
  return (
    <section className="section" aria-labelledby="turn-title">
      <div className="section-head">
        <h2 className="section-title" id="turn-title">
          あなたの番 <span className={`${styles.count} mono`}>{items.length}</span>
        </h2>
        <span className="section-note">
          {scope === "all" ? "全リポジトリ・待ちが長い順" : "待ちが長い順"}
        </span>
      </div>

      {errors.map((result) =>
        result.ok ? null : (
          <p className={styles.error} key={`${result.owner}/${result.repo}`}>
            <span className="mono">
              {result.owner}/{result.repo}
            </span>
            ：{result.error.message}
          </p>
        ),
      )}

      {items.length === 0 ? (
        <p className={`empty ${styles.empty}`}>今はAIの番です</p>
      ) : (
        <ul className={styles.list}>
          {items.map((item) => (
            <TurnRow
              key={`${item.owner}/${item.repo}#${item.issue.number}`}
              owner={item.owner}
              repo={item.repo}
              issueNumber={item.issue.number}
              title={item.issue.title}
              stage={item.status.stage}
              url={item.issue.url}
              description={item.description}
              wait={formatWait(item.waitingSince, now)}
              buttons={item.buttons}
              merge={item.merge}
            >
              <ProgressBar status={item.status} />
            </TurnRow>
          ))}
        </ul>
      )}
    </section>
  );
}
