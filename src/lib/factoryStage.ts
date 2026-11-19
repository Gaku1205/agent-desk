import type { RunStepData, WorkflowRunData } from "./github/types";
import { formatDuration } from "./stepLog";

/**
 * 工場の Issue（`新サービス：`）の今の段を、ラベルと Actions の実行から決める純粋関数
 * （docs/spec.md の「工場の今の段」）。「いまの様子」の文に使う
 */

export const FACTORY_WAIT_LABEL = "factory:wait";
/** 工場の相談のワークフロー名と、本番を作るワークフロー名（`factory.yml` の `name`） */
export const FACTORY_TALK_RUN = "Factory talk";
export const FACTORY_BUILD_RUN = "Factory";

export type FactoryPhaseKind = "waiting" | "working" | "building" | "done" | "unknown";

export type FactoryPhase = {
  kind: FactoryPhaseKind;
  /** 作業中・本番を作っている間の、段の文（`作っています`）。それ以外は null */
  text: string | null;
  /** 動いている実行の始まった時刻（無ければ null） */
  startedAt: string | null;
};

export type FactoryStageInput = {
  labels: string[];
  state: "open" | "closed";
  /** 直近の Actions の実行。取れていない（null・無し）ときはラベルだけで決める */
  runs?: WorkflowRunData[] | null;
  /** 動いている実行の今のステップ */
  runSteps?: RunStepData[];
};

/** 工場の実行（相談か本番）か */
export function isFactoryRun(run: WorkflowRunData): boolean {
  return run.name === FACTORY_TALK_RUN || run.name === FACTORY_BUILD_RUN;
}

function isActive(run: WorkflowRunData): boolean {
  return run.status === "queued" || run.status === "in_progress";
}

/** 新しく始まった順に並べて先頭（動いている実行） */
function newest(runs: WorkflowRunData[]): WorkflowRunData | undefined {
  return [...runs].sort((a, b) => (b.startedAt ?? b.updatedAt).localeCompare(a.startedAt ?? a.updatedAt))[0];
}

function stepOf(run: WorkflowRunData, steps: RunStepData[] | undefined): RunStepData | undefined {
  return run.id === undefined ? undefined : steps?.find((step) => step.runId === run.id);
}

/** 相談の実行のステップ名から、段の文 */
function talkText(stepName: string | undefined): string {
  const name = (stepName ?? "").trim();
  if (name.startsWith("関門と審査の準備")) return "関門と審査の準備をしています";
  if (name.startsWith("審査の結果")) return "審査の結果をまとめています";
  return "作っています";
}

/** 本番の実行のジョブ名から、段の文 */
function buildText(jobName: string | null | undefined): string {
  switch ((jobName ?? "").trim()) {
    case "plan":
      return "企画を作っています";
    case "design":
    case "design-pick":
      return "デザインを作っています";
    case "build":
      return "サービスを作っています";
    case "deploy":
      return "公開しています";
    default:
      return "作っています";
  }
}

/** 動いている本番（`Factory`）の実行の、今のジョブ名（`plan`・`design`・`build`・`deploy`。無ければ null） */
export function factoryBuildJob(runs: WorkflowRunData[] | null | undefined, steps: RunStepData[] | undefined): string | null {
  const build = newest((runs ?? []).filter((run) => isActive(run) && run.name === FACTORY_BUILD_RUN));
  if (!build) return null;
  return (stepOf(build, steps)?.jobName ?? "").trim() || null;
}

export function factoryStage(input: FactoryStageInput): FactoryPhase {
  const waiting = input.labels.includes(FACTORY_WAIT_LABEL);
  if (!input.runs) {
    return { kind: waiting ? "waiting" : "unknown", text: null, startedAt: null };
  }
  if (waiting) return { kind: "waiting", text: null, startedAt: null };
  const active = input.runs.filter((run) => isActive(run));
  const talk = newest(active.filter((run) => run.name === FACTORY_TALK_RUN));
  if (talk) {
    return {
      kind: "working",
      text: talkText(stepOf(talk, input.runSteps)?.name),
      startedAt: talk.startedAt ?? null,
    };
  }
  const build = newest(active.filter((run) => run.name === FACTORY_BUILD_RUN));
  if (build) {
    return {
      kind: "building",
      text: buildText(stepOf(build, input.runSteps)?.jobName),
      startedAt: build.startedAt ?? null,
    };
  }
  if (input.state === "closed") return { kind: "done", text: null, startedAt: null };
  return { kind: "unknown", text: null, startedAt: null };
}

/** 経過時間：`12分`・`1時間5分`・`1分未満`。始まった時刻が読めなければ null */
export function factoryElapsed(startedAt: string | null, now: Date): string | null {
  if (startedAt === null) return null;
  const started = Date.parse(startedAt);
  if (Number.isNaN(started)) return null;
  const ms = Math.max(0, now.getTime() - started);
  if (ms < 60_000) return "1分未満";
  return formatDuration(Math.floor(ms / 60_000) * 60_000);
}

/** 「いまの様子」の工場の文 */
export function factoryChatText(phase: FactoryPhase, now: Date): string {
  switch (phase.kind) {
    case "waiting":
      return "工場の担当・相談待ち";
    case "working":
    case "building": {
      const elapsed = factoryElapsed(phase.startedAt, now);
      return `${phase.text ?? "作っています"}${elapsed ? `（${elapsed}）` : ""}`;
    }
    default:
      return "工場が受け付けています";
  }
}
