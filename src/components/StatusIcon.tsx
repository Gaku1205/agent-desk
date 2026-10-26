import { statusIconSpec, type IconTone } from "@/lib/describe";
import type { IssueStatus } from "@/lib/status";
import styles from "./StatusIcon.module.css";

const TONE_COLOR: Record<IconTone, string> = {
  human: "var(--human)",
  ai: "var(--ai)",
  done: "var(--done)",
  fail: "var(--fail)",
  idle: "var(--idle)",
};

/** 段階の状態アイコン（14×14、色は誰の番か。形でも状態が分かる） */
export function StatusIcon({ status }: { status: IssueStatus }) {
  const { shape, tone, spinning } = statusIconSpec(status);
  const color = TONE_COLOR[tone];
  return (
    <svg
      className={styles.icon}
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      {shape === "dashed" && (
        <circle cx="7" cy="7" r="5.5" stroke={color} strokeDasharray="2.2 2" />
      )}
      {shape === "paused" && (
        <>
          <circle cx="7" cy="7" r="5.5" stroke={color} strokeDasharray="2.2 2" />
          <path d="M5.5 4.8v4.4M8.5 4.8v4.4" stroke={color} strokeLinecap="round" />
        </>
      )}
      {shape === "half" && (
        <>
          <circle cx="7" cy="7" r="5.5" stroke={color} />
          <path
            className={spinning ? styles.spin : undefined}
            d="M7 3.5a3.5 3.5 0 0 1 0 7z"
            fill={color}
          />
        </>
      )}
      {shape === "check" && (
        <>
          <circle cx="7" cy="7" r="6.25" fill={color} />
          <path
            d="M4.3 7.2l1.8 1.8 3.6-3.8"
            stroke="var(--bg)"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      )}
      {shape === "cross" && (
        <>
          <circle cx="7" cy="7" r="6.25" fill={color} />
          <path d="M4.8 4.8l4.4 4.4M9.2 4.8l-4.4 4.4" stroke="var(--bg)" strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}
