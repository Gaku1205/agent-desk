import { Fragment } from "react";
import { isExternalUrl } from "@/lib/externalUrl";
import { flowStepLabel, isSolidLink, type FlowStep } from "@/lib/flow";
import type { FlowTargetData as FlowTarget } from "@/lib/flowTarget";
import { CheckIcon, CrossIcon, FlowStepIcon, SpinnerIcon } from "./icons";
import styles from "./FlowMap.module.css";

function StateMark({ step }: { step: FlowStep }) {
  return (
    <span className={styles.mark} data-state={step.state} aria-hidden="true">
      {step.state === "done" ? (
        <CheckIcon />
      ) : step.state === "failed" ? (
        <CrossIcon />
      ) : step.state === "running" ? (
        <span className={styles.spin}>
          <SpinnerIcon />
        </span>
      ) : (
        "…"
      )}
    </span>
  );
}

function Steps({ target }: { target: FlowTarget }) {
  return (
    <ol className={styles.steps} aria-label={`進捗図：${target.label}`}>
      {target.flow.steps.map((step, index) => (
        <Fragment key={step.key}>
          {index > 0 && (
            <li
              className={styles.line}
              data-solid={isSolidLink(target.flow, index - 1) ? "" : undefined}
              aria-hidden="true"
            />
          )}
          <li
            className={styles.step}
            data-current={step.current ? "" : undefined}
            data-state={step.state}
            aria-label={flowStepLabel(step)}
            aria-current={step.current ? "step" : undefined}
          >
            <span className={styles.icon}>
              <FlowStepIcon step={step.key} />
            </span>
            <span className={styles.text} aria-hidden="true">
              <span className={styles.name}>{step.name}</span>
              <span className={styles.model}>{step.model}</span>
            </span>
            <StateMark step={step} />
          </li>
        </Fragment>
      ))}
    </ol>
  );
}

/** 進捗図：左から右へ、7つの工程のブロックを線でつなぐ（docs/design.md の「進捗図」） */
export function FlowMap({ target }: { target: FlowTarget | null }) {
  if (!target) {
    return (
      <section className={styles.flow} aria-label="進捗図">
        <p className={styles.empty}>いま動いている作業はありません</p>
      </section>
    );
  }
  const external = isExternalUrl(target.url);
  return (
    <section className={styles.flow} aria-label="進捗図">
      <div className={styles.inner}>
        <p className={styles.head}>
          <a
            className={styles.link}
            href={target.url}
            target={external ? "_blank" : undefined}
            rel={external ? "noreferrer noopener" : undefined}
          >
            <span className={`${styles.ref} num`}>{target.label}</span>
            <span className={styles.title}>{target.title}</span>
          </a>
        </p>
        <div className={styles.scroll}>
          <Steps target={target} />
        </div>
      </div>
    </section>
  );
}
