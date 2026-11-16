import { isExternalUrl } from "@/lib/externalUrl";
import { FLOW_STATE_LABEL, flowStepLabel, isSolidLink, type Flow, type FlowState, type FlowStep } from "@/lib/flow";
import { fixLabel } from "@/lib/flowBranch";
import type { FlowTargetData as FlowTarget } from "@/lib/flowTarget";
import { CheckIcon, CrossIcon, FlowStepIcon, SpinnerIcon } from "./icons";
import styles from "./FlowMap.module.css";

function StateMark({ state }: { state: FlowState }) {
  return (
    <span className={styles.mark} data-state={state} aria-hidden="true">
      {state === "done" ? (
        <CheckIcon />
      ) : state === "failed" ? (
        <CrossIcon />
      ) : state === "running" ? (
        <span className={styles.spin}>
          <SpinnerIcon />
        </span>
      ) : (
        "…"
      )}
    </span>
  );
}

/**
 * CI失敗時の修正：CIの下に字下げした枠。「修正 n回目 / 3」を1回ずつ縦に並べる。
 * 枠の左の縦線が、修正からCIに戻る線（docs/design.md の「CI失敗時の分岐」）
 */
function Branch({ flow }: { flow: Flow }) {
  const branch = flow.branch;
  if (!branch) return null;
  const fix = flow.steps.find((step) => step.key === "fix");
  const notTaken = branch.branch === "notTaken";
  const tries = Array.from({ length: branch.n }, (_, index) => index + 1);
  return (
    <div
      className={styles.branch}
      data-branch={branch.branch}
      data-return={branch.returnLine ? "" : undefined}
      role="group"
      aria-label={`CI失敗時の修正${notTaken ? "（通らなかった枝）" : ""}`}
    >
      <p className={styles.branchHead} aria-hidden="true">
        CI失敗時の修正
      </p>
      <ol className={styles.tries}>
        {tries.map((n) => {
          // 前の回は直し終えている。最後の回だけ、今の修正の状態（進捗ログの修正の開始時刻も最後の回に付ける）
          const last = n === branch.n;
          const state: FlowState = last ? branch.fixState : "done";
          const started = last ? (fix?.started ?? null) : null;
          const label = fixLabel(n);
          return (
            <li key={n}>
              <span
                className={styles.try}
                role="img"
                aria-label={`${label}　${FLOW_STATE_LABEL[state]}　モデル ${fix?.model ?? ""}${started ? `　開始 ${started}` : ""}`}
              >
                <StateMark state={state} />
                <span className={styles.tryName} aria-hidden="true">
                  {label}
                </span>
                {started && (
                  <span className={`${styles.time} num`} aria-hidden="true">
                    {started}
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function Step({ step, flow, index }: { step: FlowStep; flow: Flow; index: number }) {
  const last = index === flow.steps.length - 1;
  const sub = [step.model, step.duration].filter(Boolean).join(" · ");
  return (
    <li
      className={styles.step}
      data-current={step.current ? "" : undefined}
      data-state={step.state}
      data-solid={!last && isSolidLink(flow, index) ? "" : undefined}
      data-last={last ? "" : undefined}
      aria-current={step.current ? "step" : undefined}
    >
      <div className={styles.row} role="img" aria-label={flowStepLabel(step)}>
        <span className={styles.icon} aria-hidden="true">
          <FlowStepIcon step={step.key} />
        </span>
        <span className={styles.text} aria-hidden="true">
          <span className={styles.name}>{step.name}</span>
          <span className={`${styles.model} num`}>{sub}</span>
        </span>
        <span className={styles.side} aria-hidden="true">
          {step.started && <span className={`${styles.time} num`}>{step.started}</span>}
          <StateMark state={step.state} />
        </span>
      </div>
      {step.key === "ci" && <Branch flow={flow} />}
    </li>
  );
}

/** 進捗図：右の列に、上から下へ、7つの工程を縦の線でつなぐ（docs/design.md の「進捗図」） */
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
      <div className={styles.head}>
        <p className={`${styles.label} num`}>進捗図 · {target.label}</p>
        <a
          className={styles.title}
          href={target.url}
          target={external ? "_blank" : undefined}
          rel={external ? "noreferrer noopener" : undefined}
        >
          {target.title}
        </a>
      </div>
      <ol className={styles.steps} aria-label={`進捗図：${target.label}`}>
        {target.flow.steps.map((step, index) => (
          <Step key={step.key} step={step} flow={target.flow} index={index} />
        ))}
      </ol>
    </section>
  );
}
