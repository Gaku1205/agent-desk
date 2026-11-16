import { getFlowBranch, type CiResult, type FlowBranch } from "./flowBranch";
import type { BaseStage, IssueStatus } from "./status";
import type { StepInfo } from "./stepLog";

/** 進捗図の工程（左から右。docs/spec.md の「進捗図」） */
export const FLOW_STEPS = [
  { key: "plan", name: "企画" },
  { key: "design", name: "デザイン" },
  { key: "implement", name: "実装" },
  { key: "ci", name: "CI" },
  { key: "review", name: "レビュー" },
  { key: "fix", name: "修正" },
  { key: "deploy", name: "公開" },
] as const;

export type FlowStepKey = (typeof FLOW_STEPS)[number]["key"];

/** 工程の状態：成功・失敗・進行中・待ち */
export type FlowState = "done" | "failed" | "running" | "waiting";

export const FLOW_STATE_LABEL: Record<FlowState, string> = {
  done: "成功",
  failed: "失敗",
  running: "進行中",
  waiting: "待ち",
};

/** 記録を読むまでのモデル名 */
export const UNKNOWN_MODEL = "不明";

export type FlowStep = {
  key: FlowStepKey;
  name: string;
  /** モデル名（記録が無ければ「不明」） */
  model: string;
  /** 所要時間（`3分12秒`。出せなければ null） */
  duration: string | null;
  /** 開始時刻（`16:57`。出せなければ null） */
  started: string | null;
  state: FlowState;
  /** 今の位置の工程 */
  current: boolean;
};

export type Flow = {
  /** 今の位置（0〜6） */
  at: number;
  steps: FlowStep[];
  /** CI失敗時の分岐（無ければ null。docs/spec.md の「CI失敗時の分岐」） */
  branch: FlowBranch | null;
};

const PLAN = 0;
const IMPLEMENT = 2;
const CI = 3;
const REVIEW = 4;
const FIX = 5;
const DEPLOY = 6;

function position(status: IssueStatus, stage: BaseStage): { at: number; state: FlowState } {
  const confirmingFix = status.verifyingFix && (stage === "ciRunning" || stage === "ciFailed" || stage === "reviewing");
  if (confirmingFix) return { at: FIX, state: stage === "ciFailed" ? "failed" : "running" };
  switch (stage) {
    case "notStarted":
    case "queued":
    case "skipped":
    case "question":
    case "factoryTalk":
      return { at: PLAN, state: status.grace ? "running" : "waiting" };
    case "planning":
      return { at: PLAN, state: "running" };
    case "implementing":
      return { at: IMPLEMENT, state: "running" };
    case "prWaiting":
      return {
        at: IMPLEMENT,
        state: status.grace ? "running" : status.implementError ? "failed" : "done",
      };
    case "ciRunning":
      return { at: CI, state: "running" };
    case "ciFailed":
      return { at: CI, state: "failed" };
    case "reviewing":
      return { at: REVIEW, state: "running" };
    case "fixing":
      return { at: FIX, state: "running" };
    case "mergeWaiting":
      if (status.mergeWait === "needsReview" || !status.reviewedClean) return { at: REVIEW, state: "waiting" };
      return { at: status.fixCount > 0 ? FIX : REVIEW, state: "done" };
    case "deploying":
      return { at: DEPLOY, state: "running" };
    case "deployFailed":
      return { at: DEPLOY, state: "failed" };
    case "deployed":
      return { at: DEPLOY, state: "done" };
  }
}

/** 今の位置より左の工程で、データから決められない物（待ちにする） */
function unknownBefore(status: IssueStatus, index: number): boolean {
  const key = FLOW_STEPS[index].key;
  if (key === "design") return true;
  if (key === "plan") return !status.planned;
  if (key === "fix") return status.fixCount === 0;
  return false;
}

/** 段階から、進捗図の7つの工程の状態と今の位置を決める（docs/spec.md の「進捗図」） */
export function getFlow(status: IssueStatus): Flow {
  const stage: BaseStage =
    status.stage === "stuck"
      ? (status.stageBeforeStuck ?? "notStarted")
      : status.stage === "retrying"
        ? (status.stageBeforeRetry ?? "notStarted")
        : status.stage;
  const { at, state: found } = position(status, stage);
  const state: FlowState = status.stage === "stuck" ? "failed" : status.stage === "retrying" ? "waiting" : found;

  const steps = FLOW_STEPS.map(({ key, name }, index): FlowStep => ({
    key,
    name,
    model: UNKNOWN_MODEL,
    duration: null,
    started: null,
    state: index < at ? (unknownBefore(status, index) ? "waiting" : "done") : index === at ? state : "waiting",
    current: index === at,
  }));
  const branch = getFlowBranch({
    ci: ciResult(stage),
    fixCount: status.fixCount,
    fixing: stage === "fixing",
    stuck: status.stage === "stuck",
  });
  return { at, steps, branch };
}

/** 段階から見たCIの結果。CIより前は「まだ」、CIより後（レビュー以降）は「通った」 */
function ciResult(stage: BaseStage): CiResult {
  switch (stage) {
    case "ciRunning":
      return "running";
    case "ciFailed":
    case "fixing":
      return "failed";
    case "reviewing":
    case "mergeWaiting":
    case "deploying":
    case "deployFailed":
    case "deployed":
      return "passed";
    default:
      return "none";
  }
}

/** 進捗ログの記録を工程に渡す。記録が無い工程・モデルを使わない工程（null）は「不明」、所要時間・開始時刻は出せなければ null */
export function applyStepLog(flow: Flow, infos: readonly StepInfo[]): Flow {
  if (infos.length === 0) return flow;
  const byKey = new Map(infos.map((info) => [info.key, info]));
  return {
    ...flow,
    steps: flow.steps.map((step) => {
      const info = byKey.get(step.key);
      return info
        ? { ...step, model: info.model ?? UNKNOWN_MODEL, duration: info.duration, started: info.started }
        : step;
    }),
  };
}

/** 左から index 番目の線（index と index+1 のブロックの間）が実線か。右のブロックが今の位置までなら実線 */
export function isSolidLink(flow: Pick<Flow, "at">, index: number): boolean {
  return index + 1 <= flow.at;
}

/** 工程の読み上げの文（`企画　成功　モデル 不明`。開始時刻・所要時間があれば続ける） */
export function flowStepLabel(
  step: Pick<FlowStep, "name" | "state" | "model"> & { duration?: string | null; started?: string | null },
): string {
  const start = step.started ? `　開始 ${step.started}` : "";
  const time = step.duration ? `　所要時間 ${step.duration}` : "";
  return `${step.name}　${FLOW_STATE_LABEL[step.state]}　モデル ${step.model}${start}${time}`;
}
