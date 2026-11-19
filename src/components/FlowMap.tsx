import { isExternalUrl } from "@/lib/externalUrl";
import {
  factoryStepLabel,
  factoryStepSub,
  type FactoryProgress,
  type FactoryStepKey,
  type FactoryStepState,
} from "@/lib/factoryProgress";
import {
  FLOW_STATE_LABEL,
  flowStepLabel,
  isSolidLink,
  type Flow,
  type FlowState,
  type FlowStep,
  type FlowStepKey,
} from "@/lib/flow";
import { fixLabel } from "@/lib/flowBranch";
import {
  DESIGN_SKIPPED_LABEL,
  extraRowLabel,
  getFlowExtras,
  NO_FLOW_EXTRAS,
  type ExtraBranch,
  type FlowExtras,
} from "@/lib/flowExtraBranches";
import type { FlowTargetData as FlowTarget } from "@/lib/flowTarget";
import type { CiProgress } from "@/lib/ciProgress";
import { chatCi } from "@/lib/conversation";
import { CiLine, CiText } from "./CiProgress";
import { CheckIcon, CrossIcon, FlowStepIcon, SpinnerIcon } from "./icons";
import { QueueIcon } from "./QueueIcon";
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

/** ほかの分岐（企画の待ち・審査・レビューの指摘・マージ・止まった）：工程の下に字下げした枠（docs/design.md の「ほかの分岐」） */
function ExtraBranchBox({ branch }: { branch: ExtraBranch }) {
  return (
    <div
      className={styles.branch}
      data-kind={branch.kind}
      data-return={branch.returnLine ? "" : undefined}
      role="group"
      aria-label={branch.head}
    >
      <p className={styles.branchHead} aria-hidden="true">
        {branch.head}
      </p>
      <ol className={styles.tries}>
        {branch.rows.map((row) => (
          <li key={row.label}>
            <span className={styles.try} role="img" aria-label={extraRowLabel(row)}>
              <StateMark state={row.state} />
              <span className={styles.tryName} aria-hidden="true">
                {row.label === "順番待ち" && (
                  <span className={styles.tryIcon}>
                    <QueueIcon size={12} />
                  </span>
                )}
                {row.label}
              </span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Step({
  step,
  flow,
  index,
  extras,
  ci,
}: {
  step: FlowStep;
  flow: Flow;
  index: number;
  extras: FlowExtras;
  /** CI の段の間だけ、CI のチェックの線と数 */
  ci: CiProgress | null;
}) {
  const last = index === flow.steps.length - 1;
  // デザインの行：画面案ありは成功、通らなかったときは「飛ばした」（docs/spec.md の「ほかの分岐」）
  const skipped = step.key === "design" && extras.design === "skipped";
  const shown: FlowStep = step.key === "design" && extras.design === "made" ? { ...step, state: "done" } : step;
  const sub = skipped ? DESIGN_SKIPPED_LABEL : [shown.model, shown.duration].filter(Boolean).join(" · ");
  // 進捗ログを読み込み中：モデル名・所要時間の位置に、文字なしの帯を出す（「不明」は出さない）
  const loading = !skipped && shown.model === null;
  const branches = extras.branches.filter((branch) => branch.anchor === step.key);
  return (
    <li
      className={styles.step}
      data-current={shown.current ? "" : undefined}
      data-state={shown.state}
      data-solid={!last && isSolidLink(flow, index) ? "" : undefined}
      data-last={last ? "" : undefined}
      data-skipped={skipped ? "" : undefined}
      aria-current={shown.current ? "step" : undefined}
    >
      <div
        className={styles.row}
        role="img"
        aria-label={skipped ? `${shown.name}　${DESIGN_SKIPPED_LABEL}` : flowStepLabel(shown)}
      >
        <span className={styles.icon} aria-hidden="true">
          <FlowStepIcon step={shown.key} />
        </span>
        <span className={styles.text} aria-hidden="true">
          <span className={styles.name}>{shown.name}</span>
          <span className={`${styles.model} num`}>
            {loading ? <span className={styles.bone} /> : sub}
          </span>
        </span>
        {!skipped && (
          <span className={styles.side} aria-hidden="true">
            {shown.started && <span className={`${styles.time} num`}>{shown.started}</span>}
            <StateMark state={shown.state} />
          </span>
        )}
      </div>
      {step.key === "ci" && ci && (
        <div className={styles.ci}>
          <CiText at={flow.at} ci={ci} />
          <CiLine ci={ci} />
        </div>
      )}
      {step.key === "ci" && <Branch flow={flow} />}
      {branches.map((branch) => (
        <ExtraBranchBox key={branch.kind} branch={branch} />
      ))}
    </li>
  );
}

/** 工場の段のアイコンは、通常の工程のアイコンを使う（新しい絵は足さない） */
const FACTORY_ICON: Record<FactoryStepKey, FlowStepKey> = {
  ideas: "plan",
  looks: "design",
  mocks: "design",
  confirm: "review",
  repo: "implement",
  design: "design",
  build: "implement",
  deploy: "deploy",
};

function FactoryMark({ state }: { state: FactoryStepState }) {
  return (
    <span className={styles.mark} data-state={state === "waiting" ? "you" : state === "pending" ? "waiting" : state} aria-hidden="true">
      {state === "done" ? (
        <CheckIcon />
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

/** 工場の Issue の進捗図：工場の段を縦に並べる（docs/design.md の「工場の進捗図」） */
function FactorySteps({ factory, inline }: { factory: FactoryProgress; inline: boolean }) {
  return (
    <ol className={`${styles.steps} ${inline ? styles.inlineSteps : ""}`} aria-label="進捗図：工場の段" data-factory="">
      {factory.steps.map((step, index) => {
        const next = factory.steps[index + 1];
        const last = next === undefined;
        const sub = factoryStepSub(step);
        const current = step.state === "running" || step.state === "waiting";
        return (
          <li
            key={step.key}
            className={styles.step}
            data-current={current ? "" : undefined}
            data-state={step.state === "waiting" ? "you" : step.state}
            data-solid={!last && next.state !== "pending" ? "" : undefined}
            data-last={last ? "" : undefined}
            aria-current={current ? "step" : undefined}
          >
            <div className={styles.row} role="img" aria-label={factoryStepLabel(step)}>
              <span className={styles.icon} aria-hidden="true">
                <FlowStepIcon step={FACTORY_ICON[step.key]} />
              </span>
              <span className={styles.text} aria-hidden="true">
                <span className={styles.name}>{step.name}</span>
                <span className={`${styles.model} num`}>{sub ?? " "}</span>
              </span>
              <span className={styles.side} aria-hidden="true">
                {step.started && <span className={`${styles.time} num`}>{step.started}</span>}
                <FactoryMark state={step.state} />
              </span>
            </div>
            {step.key === "repo" && factory.repo && (
              <div className={styles.ci}>
                <a className={styles.repoLink} href={factory.repo.url} target="_blank" rel="noreferrer noopener">
                  {factory.repo.name} ↗
                </a>
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function ciOf(target: FlowTarget): CiProgress | null {
  return target.extra ? chatCi(target.extra.status) : null;
}

function extrasOf(target: FlowTarget): FlowExtras {
  return target.extra ? getFlowExtras({ ...target.extra, stepLog: target.stepLog ?? null }) : NO_FLOW_EXTRAS;
}

/** 進捗図：右の列に、上から下へ、7つの工程を縦の線でつなぐ（docs/design.md の「進捗図」） */
export function FlowMap({
  target,
  inline = false,
  unreadable = false,
}: {
  target: FlowTarget | null;
  inline?: boolean;
  /** 読めなかったリポジトリがある（出す1件が無いとき、「無い」と言い切らない） */
  unreadable?: boolean;
}) {
  if (inline && target) {
    // スマホ：「いまの様子」の行の下に開く。見出しは行にあるので付けない。図だけが横にスクロールする
    const extras = extrasOf(target);
    const ci = ciOf(target);
    if (target.factory) {
      return (
        <div className={styles.inlineScroll} role="region" aria-label="進捗図" tabIndex={0}>
          <FactorySteps factory={target.factory} inline />
        </div>
      );
    }
    return (
      <div className={styles.inlineScroll} role="region" aria-label="進捗図" tabIndex={0}>
        <ol className={`${styles.steps} ${styles.inlineSteps}`} aria-label={`進捗図：${target.label}`}>
          {target.flow.steps.map((step, index) => (
            <Step key={step.key} step={step} flow={target.flow} index={index} extras={extras} ci={ci} />
          ))}
        </ol>
      </div>
    );
  }
  if (!target) {
    return (
      <section className={styles.flow} aria-label="進捗図">
        <p className={styles.empty}>
          {unreadable ? "読めなかったリポジトリの作業は、ここに出せません" : "いま動いている作業はありません"}
        </p>
      </section>
    );
  }
  const external = isExternalUrl(target.url);
  const extras = extrasOf(target);
  const ci = ciOf(target);
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
      {target.factory ? (
        <FactorySteps factory={target.factory} inline={false} />
      ) : (
        <ol className={styles.steps} aria-label={`進捗図：${target.label}`}>
          {target.flow.steps.map((step, index) => (
            <Step key={step.key} step={step} flow={target.flow} index={index} extras={extras} ci={ci} />
          ))}
        </ol>
      )}
    </section>
  );
}
