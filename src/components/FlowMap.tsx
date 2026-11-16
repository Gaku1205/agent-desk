import { Fragment } from "react";
import { isExternalUrl } from "@/lib/externalUrl";
import { FLOW_STATE_LABEL, flowStepLabel, isSolidLink, type Flow, type FlowStep } from "@/lib/flow";
import { fixLabel } from "@/lib/flowBranch";
import type { FlowTargetData as FlowTarget } from "@/lib/flowTarget";
import { CheckIcon, CrossIcon, FlowStepIcon, SpinnerIcon } from "./icons";
import styles from "./FlowMap.module.css";

/** ブロックの幅と線の長さ（FlowMap.module.css の .step・.line と同じ） */
const STEP_WIDTH = 144;
const LINK_WIDTH = 20;

function StateMark({ step }: { step: Pick<FlowStep, "state"> }) {
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

/** CI失敗時の分岐：CIブロックの下に開く点線の枠。中に「修正 n回目 / 3」、CIへ戻る線（docs/design.md の「CI失敗時の分岐」） */
function Branch({ flow }: { flow: Flow }) {
  const branch = flow.branch;
  if (!branch) return null;
  const fix = flow.steps.find((step) => step.key === "fix");
  const ciIndex = flow.steps.findIndex((step) => step.key === "ci");
  const notTaken = branch.branch === "notTaken";
  const label = fixLabel(branch.n);
  return (
    <div
      className={styles.branch}
      data-branch={branch.branch}
      style={{ marginLeft: ciIndex * (STEP_WIDTH + LINK_WIDTH) }}
      role="group"
      aria-label={`CI失敗時の修正${notTaken ? "（通らなかった枝）" : ""}`}
    >
      {branch.returnLine && <span className={styles.back} aria-hidden="true" />}
      <div className={styles.frame}>
        <div
          className={styles.step}
          data-state={branch.fixState}
          role="img"
          aria-label={`${label}　${FLOW_STATE_LABEL[branch.fixState]}　モデル ${fix?.model ?? ""}`}
        >
          <span className={styles.icon}>
            <FlowStepIcon step="fix" />
          </span>
          <span className={styles.text} aria-hidden="true">
            <span className={styles.name}>{label}</span>
            <span className={styles.model}>{fix?.model}</span>
          </span>
          <StateMark step={{ state: branch.fixState }} />
        </div>
      </div>
    </div>
  );
}

function Steps({ target }: { target: FlowTarget }) {
  return (
    <>
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
    <Branch flow={target.flow} />
    </>
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
