import Link from "next/link";
import { formatSpan } from "@/lib/dashboard/duration";
import { longestStep, maxP90, type Throughput, type ThroughputStep } from "@/lib/dashboard/throughput";
import { FLOW_STEPS, type FlowStepKey } from "@/lib/flow";
import styles from "./DashboardThroughput.module.css";
import { ArrowUpIcon, FlowStepIcon } from "./icons";
import { QueueIcon } from "./QueueIcon";

const DASH = "—";

const STEP_NAMES: Record<ThroughputStep, string> = {
  plan: "企画",
  implement: "実装",
  ci: "CI",
  review: "レビュー",
  fix: "修正",
  queue: "Queue",
};

function StepIcon({ step, size = 17 }: { step: ThroughputStep; size?: number }) {
  if (step === "queue") return <QueueIcon size={size} />;
  const key: FlowStepKey = FLOW_STEPS.find((flow) => flow.key === step)?.key ?? "plan";
  return <FlowStepIcon step={key} size={size} />;
}

function span(value: number | null): string {
  return value === null ? DASH : formatSpan(value);
}

type Props = {
  throughput: Throughput;
  /** デモは `/demo` */
  basePath?: string;
};

/** Throughput：左にリポジトリごとのマージ数の横棒、右に工程ごとの時間（median と p90）、下にいちばん長い工程 */
export function DashboardThroughput({ throughput, basePath = "" }: Props) {
  const maxMerged = Math.max(1, ...throughput.repos.map((repo) => repo.merged));
  const scale = maxP90(throughput.steps);
  const longest = longestStep(throughput.steps);
  return (
    <section className={styles.section} aria-labelledby="throughput-heading">
      <h2 className={styles.head} id="throughput-heading">
        <ArrowUpIcon size={16} />
        <span>Throughput</span>
        <span className={styles.sub}>進み具合</span>
      </h2>
      <div className={styles.body}>
        <div>
          <p className={styles.label}>Merged（リポジトリごと）</p>
          {throughput.repos.length === 0 ? (
            <p className={`${styles.none} num`}>{DASH}</p>
          ) : (
            <ul className={styles.repos}>
              {throughput.repos.map((repo) => (
                <li key={`${repo.owner}/${repo.repo}`} className={styles.repoRow}>
                  <Link href={`${basePath}/repos/${repo.owner}/${repo.repo}`} className={styles.repoName}>
                    {repo.owner}/{repo.repo}
                  </Link>
                  <span className={styles.repoValue}>
                    <span className="num">{repo.merged}</span>
                  </span>
                  <span className={styles.track}>
                    <span className={styles.fill} style={{ width: `${Math.max((repo.merged / maxMerged) * 100, 1)}%` }} aria-hidden="true" />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <p className={styles.label}>工程ごとの時間（1件あたり）</p>
          <ul className={styles.legend} aria-hidden="true">
            <li>
              <span className={styles.swatchMedian} />
              <span>median</span>
            </li>
            <li>
              <span className={styles.swatchP90} />
              <span>p90</span>
            </li>
          </ul>
          <ul className={styles.steps}>
            {throughput.steps.map((row) => (
              <li key={row.step} className={styles.stepRow}>
                <span className={styles.stepName}>
                  <StepIcon step={row.step} />
                  <span>{STEP_NAMES[row.step]}</span>
                </span>
                <span className={styles.stepBars}>
                  {scale !== null && row.medianMs !== null && row.p90Ms !== null && (
                    <>
                      <span className={styles.median} style={{ width: `${Math.max((row.medianMs / scale) * 100, 1)}%` }} aria-hidden="true" />
                      <span className={styles.p90} style={{ width: `${Math.max((row.p90Ms / scale) * 100, 1)}%` }} aria-hidden="true" />
                    </>
                  )}
                </span>
                <span className={`${styles.stepValue} num`} aria-label={`${STEP_NAMES[row.step]} median ${span(row.medianMs)}、p90 ${span(row.p90Ms)}`}>
                  {span(row.medianMs)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      {longest !== null && (
        <p className={styles.longest}>
          いちばん長いのは{" "}
          {longest === "queue" ? (
            <>
              <QueueIcon size={14} /> Queue（順番待ち）。触るファイルが重なる物は、並列でも待つ。{" "}
              <Link href={`${basePath}/lanes`} className={styles.link}>
                Slots &amp; Queue を見る →
              </Link>
            </>
          ) : (
            <>{STEP_NAMES[longest]}。</>
          )}
        </p>
      )}
    </section>
  );
}
