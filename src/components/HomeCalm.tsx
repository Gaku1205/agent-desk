import Link from "next/link";
import { calmCopy } from "@/lib/homeCalm";
import type { HomeActivity } from "@/lib/lanes/source";
import { CheckIcon, SpinnerIcon } from "./icons";
import flowStyles from "./FlowMap.module.css";
import styles from "./HomeCalm.module.css";

type Props = {
  activity: HomeActivity | null;
  unreadable: boolean;
  /** リンクの頭（デモでは `/demo`） */
  base: string;
};

/**
 * ホームの待ちが0件の画面（docs/design.md の「ホーム：待ちが0件」）。
 * チェック・題名・説明・「いま動いている」の3種の行
 */
export function HomeCalm({ activity, unreadable, base }: Props) {
  const copy = calmCopy(unreadable);
  return (
    <div className={styles.calm}>
      {copy.check && (
        <span className={styles.check} aria-hidden="true">
          <CheckIcon size={32} />
        </span>
      )}
      <h1 className={styles.title} id="turn-title" tabIndex={-1}>
        {copy.title}
      </h1>
      <p className={styles.desc}>{copy.description}</p>
      {activity && (
        <>
          <h2 className={styles.sub}>いま動いている</h2>
          <ul className={styles.rows}>
            {activity.works.map((work) => (
              <li key={work.key}>
                <Link href={`${base}/lanes`} className={styles.row}>
                  <span className={`${styles.spin} ${flowStyles.spin}`} aria-hidden="true">
                    <SpinnerIcon />
                  </span>
                  <span className={`${styles.ref} num`}>
                    {work.repo}#{work.number}
                  </span>
                  <span className={styles.workTitle}>{work.title}</span>
                  <span className={styles.step}>{work.stepName}</span>
                </Link>
              </li>
            ))}
            <li>
              <Link href={`${base}/lanes`} className={styles.row}>
                <span aria-hidden="true">⧗</span>
                <span>
                  順番待ち <span className="num">{activity.queued}</span> →
                </span>
              </Link>
            </li>
            <li>
              <Link href={`${base}/dashboard`} className={styles.row}>
                <span className={styles.ok} aria-hidden="true">
                  ✓
                </span>
                <span>
                  今日 公開 <span className="num">{activity.published}</span> →
                </span>
              </Link>
            </li>
          </ul>
        </>
      )}
    </div>
  );
}
