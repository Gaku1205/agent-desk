import type { CSSProperties } from "react";
import { ciStepText, type CiKind, type CiProgress } from "@/lib/ciProgress";
import { FLOW_STEPS } from "@/lib/flow";
import { SpinnerIcon } from "./icons";
import { QueueIcon } from "./QueueIcon";
import styles from "./CiProgress.module.css";

/**
 * CI のチェックの割合の線と数（docs/spec.md の「Slots & Queue」の「CI の段にいる間」）。
 * Slots の席の行・「いまの様子」・進捗図の CI の段で同じ物を使う
 */

/** CI のチェックの割合の線（左から 通過・実行中・枠待ち・失敗） */
export function CiLine({ ci }: { ci: CiProgress }) {
  return (
    <span className={styles.ciLine} role="img" aria-label={ci.label}>
      {ci.segments.map((segment) => (
        <span
          key={segment.kind}
          className={styles.ciSeg}
          data-kind={segment.kind}
          style={{ "--n": segment.count } as CSSProperties}
        />
      ))}
    </span>
  );
}

function CiMark({ kind }: { kind: CiKind }) {
  switch (kind) {
    case "passed":
      return <span>✓</span>;
    case "running":
      return (
        <span className={styles.spin}>
          <SpinnerIcon size={12} />
        </span>
      );
    case "queued":
      return <QueueIcon size={12} />;
    case "failed":
      return <span>×</span>;
  }
}

/** CI の段の1段目の文：`4/7 CI ✓4 ⧗6 枠待ち`（数は記号ごとに線と同じ色） */
export function CiText({ at, ci }: { at: number; ci: CiProgress }) {
  return (
    <span className={styles.ciText}>
      <span className={styles.srOnly}>{ciStepText(at, FLOW_STEPS.length, ci)}</span>
      <span className={styles.ciStep} aria-hidden="true">
        <span className="num">
          {at + 1}/{FLOW_STEPS.length}
        </span>{" "}
        CI
      </span>
      {ci.segments.map((segment) => (
        <span key={segment.kind} className={styles.ciCount} data-kind={segment.kind} aria-hidden="true">
          <CiMark kind={segment.kind} />
          <span className="num">{segment.count}</span>
        </span>
      ))}
      <span className={styles.ciWord} aria-hidden="true">
        {ci.word}
      </span>
    </span>
  );
}
