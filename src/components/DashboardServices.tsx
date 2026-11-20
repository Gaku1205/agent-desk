import { useId } from "react";
import { clockLabel, type ServiceRow, type ServicesView } from "@/lib/dashboard/services";
import { CheckIcon, CrossIcon } from "./icons";
import styles from "./DashboardServices.module.css";

/** 左の記号：よい＝チェック、悪い＝×、分からない＝— */
function Mark({ state }: { state: ServiceRow["state"] }) {
  if (state === "ok") return <CheckIcon size={14} />;
  if (state === "bad") return <CrossIcon size={14} />;
  return <span aria-hidden="true">—</span>;
}

const STATE_WORDS: Record<ServiceRow["state"], string> = { ok: "よい", bad: "悪い", unknown: "分からない" };

/** Services（Issue #719）：外のサービスの様子を1行ずつ。悪い物が上（並びはサーバーで決めてある） */
export function DashboardServices({ services }: { services: ServicesView }) {
  const headingId = useId();
  return (
    <section className={styles.services} aria-labelledby={headingId}>
      <h2 className={styles.head} id={headingId}>
        <span>Services</span>
        <span className={`${styles.sub} num`}>外のサービスの様子 · {clockLabel(Date.parse(services.checkedAt))} に確かめた</span>
      </h2>
      <ul className={styles.rows}>
        {services.rows.map((row) => (
          <li key={row.key} className={styles.row} data-state={row.state}>
            <span className={styles.name}>
              <span className={styles.mark}>
                <Mark state={row.state} />
              </span>
              <span>{row.name}</span>
              <span className={styles.srOnly}>（{STATE_WORDS[row.state]}）</span>
            </span>
            <span className={styles.body}>
              <span className={`${styles.main} num`}>{row.main}</span>
              {row.sub !== null && <span className={`${styles.note} num`}>{row.sub}</span>}
              {row.bar !== null && (
                <span className={styles.track} aria-hidden="true">
                  <span className={styles.fill} style={{ width: `${Math.max(Math.min(row.bar, 1) * 100, 1)}%` }} />
                </span>
              )}
            </span>
            <span className={`${styles.right} num`}>
              {row.right === null ? null : row.right.href ? (
                <a href={row.right.href} target="_blank" rel="noopener noreferrer" className={styles.link}>
                  {row.right.text}
                </a>
              ) : (
                row.right.text
              )}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
