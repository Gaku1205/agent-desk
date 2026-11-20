import { FLOW_STATE_LABEL, getFlow, type FlowState, type FlowStatusInput, type FlowStepKey } from "./flow";
import type { CommentData, PullData } from "./github/types";
import { parseQuestionComment } from "./question";
import { LABEL, type BaseStage, type IssueStatus } from "./status";
import type { StepInfo } from "./stepLog";

/**
 * 進捗図の、CI失敗時の分岐以外の枝（docs/spec.md の「ほかの分岐」）。
 * 起きた枝だけを返す。7つの工程・今の位置・CI失敗時の分岐（getFlow・getFlowBranch）は変えない
 */

/** 取得済みのデータから作る、枝を決める材料（取得するデータは増やさない） */
export type FlowFacts = {
  /** Issue のラベル（紐づく PR のラベルは `IssueStatus.pull` から見る） */
  labels: string[];
  /** 最新の質問のコメントに画面案がある */
  mocks: boolean;
  /** 紐づく PR に、指摘ありのレビュー（`## Code review` で `No issues found` を含まない）がある */
  reviewFindings: boolean;
};

/**
 * 画面に渡す、細い状態（docs/spec.md の「画面へ渡す物」）。進捗図の工程と枝を決める項目だけ。
 * 紐づく PR は、ラベルと、審査役の節だけを残した本文（`critiqueSection`）だけ。PR の本文・ファイル・SHA は渡さない
 */
export type FlowStatus = FlowStatusInput &
  Pick<IssueStatus, "ci"> & { pull: Pick<PullData, "labels" | "body"> | null };

export type FlowExtrasInput = {
  status: FlowStatus;
  facts: FlowFacts;
  /** 読めた進捗ログ（読んでいない・読めないときは null） */
  stepLog: readonly StepInfo[] | null;
};

/** 画面に渡す材料（進捗ログは画面で読んでから足す） */
export type FlowExtraSource = Omit<FlowExtrasInput, "stepLog">;

export type ExtraBranchKind = "wait" | "critique" | "reviewFix" | "mergeHold" | "stuck";

export type ExtraBranchRow = { label: string; state: FlowState };

export type ExtraBranch = {
  kind: ExtraBranchKind;
  /** この工程の行の下に出す */
  anchor: FlowStepKey;
  /** 枠の見出し（読み上げの名前にも使う） */
  head: string;
  rows: ExtraBranchRow[];
  /** 戻る線（枠の左の線を実線にする） */
  returnLine: boolean;
};

/** デザインの行：画面案あり（成功）・飛ばした・今までどおり（null） */
export type DesignMark = "made" | "skipped" | null;

export type FlowExtras = {
  branches: ExtraBranch[];
  design: DesignMark;
};

export const NO_FLOW_EXTRAS: FlowExtras = { branches: [], design: null };

/** 審査役の点数がこれ未満なら、実装に戻る枝を出す */
export const CRITIQUE_PASS = 8;
/** 「飛ばした」の文言 */
export const DESIGN_SKIPPED_LABEL = "飛ばした";

const BLOCKED_LABEL = "ai:blocked";
const CLAUDE_BOT = "claude[bot]";
const CRITIQUE_HEADING = /^#{1,6}\s*審査役/m;
const CRITIQUE_SCORE = /^\s*点数\s*[:：]\s*([0-9]+(?:\.[0-9]+)?)/m;

/** PR の本文の `## 審査役…` の見出しの後ろの `点数: 7.5` を読む（読めなければ null） */
export function critiqueScore(body: string): { text: string; value: number } | null {
  const heading = CRITIQUE_HEADING.exec(body);
  if (!heading) return null;
  const match = CRITIQUE_SCORE.exec(body.slice(heading.index + heading[0].length));
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? { text: match[1], value } : null;
}

/** PR の本文のうち、審査役の点数を読むのに要る所（`## 審査役…` から点数の行まで）。読めなければ空 */
export function critiqueSection(body: string): string {
  const heading = CRITIQUE_HEADING.exec(body);
  if (!heading) return "";
  const from = heading.index + heading[0].length;
  const match = CRITIQUE_SCORE.exec(body.slice(from));
  return match ? body.slice(heading.index, from + match.index + match[0].length) : "";
}

/** 画面に渡す前に、状態を細くする（進捗図の工程・枝の判定は変わらない） */
export function slimFlowStatus(status: IssueStatus): FlowStatus {
  return {
    stage: status.stage,
    stageBeforeStuck: status.stageBeforeStuck,
    stageBeforeRetry: status.stageBeforeRetry,
    fixCount: status.fixCount,
    verifyingFix: status.verifyingFix,
    mergeWait: status.mergeWait,
    reviewedClean: status.reviewedClean,
    grace: status.grace,
    implementError: status.implementError,
    planned: status.planned,
    ci: status.ci,
    pull: status.pull ? { labels: status.pull.labels, body: critiqueSection(status.pull.body) } : null,
  };
}

/** 紐づく PR に、指摘ありのレビューのコメントが1つ以上あるか */
export function hasReviewFindings(comments: CommentData[], pullNumber: number | null): boolean {
  if (pullNumber === null) return false;
  return comments.some(
    (comment) =>
      comment.issueNumber === pullNumber &&
      comment.author === CLAUDE_BOT &&
      comment.body.trimStart().startsWith("## Code review") &&
      !comment.body.includes("No issues found"),
  );
}

/** 取得済みの Issue・コメントから、枝を決める材料を作る */
export function flowFacts(
  issue: { number: number; labels: string[] },
  status: Pick<IssueStatus, "pull">,
  comments: CommentData[],
  owner: string,
): FlowFacts {
  return {
    labels: issue.labels,
    mocks: (parseQuestionComment(comments, issue.number, owner)?.mockups.length ?? 0) > 0,
    reviewFindings: hasReviewFindings(comments, status.pull?.number ?? null),
  };
}

function baseStage(status: FlowStatus): BaseStage {
  if (status.stage === "stuck") return status.stageBeforeStuck ?? "notStarted";
  if (status.stage === "retrying") return status.stageBeforeRetry ?? "notStarted";
  return status.stage;
}

const MERGED_STAGES: readonly BaseStage[] = ["deploying", "deployFailed", "deployed"];

function waitBranch(labels: Set<string>, stage: BaseStage): ExtraBranch | null {
  const rows: ExtraBranchRow[] = [];
  if (labels.has(LABEL.question)) rows.push({ label: "質問待ち", state: stage === "question" ? "waiting" : "done" });
  if (labels.has(BLOCKED_LABEL)) rows.push({ label: "他の作業の完了待ち", state: "waiting" });
  if (labels.has(LABEL.queue)) rows.push({ label: "順番待ち", state: "waiting" });
  if (rows.length === 0) return null;
  return { kind: "wait", anchor: "plan", head: "企画の待ち", rows, returnLine: false };
}

function critiqueBranch(status: FlowStatus): ExtraBranch | null {
  const score = status.pull ? critiqueScore(status.pull.body) : null;
  if (!score || score.value >= CRITIQUE_PASS) return null;
  return {
    kind: "critique",
    anchor: "implement",
    head: "審査",
    rows: [
      { label: `審査 ${score.text}点 / 10`, state: "failed" },
      { label: "実装に戻る", state: "done" },
    ],
    returnLine: true,
  };
}

function reviewFixBranch(status: FlowStatus, facts: FlowFacts, stage: BaseStage): ExtraBranch | null {
  if (!facts.reviewFindings) return null;
  const stuck = status.stage === "stuck";
  let fix: FlowState;
  let ci: FlowState;
  if (stage === "fixing") {
    fix = stuck ? "failed" : "running";
    ci = "waiting";
  } else if (status.fixCount === 0) {
    fix = "waiting";
    ci = "waiting";
  } else if (status.verifyingFix && stage === "ciRunning") {
    fix = "done";
    ci = "running";
  } else if (status.verifyingFix && stage === "ciFailed") {
    fix = "done";
    ci = "failed";
  } else {
    fix = "done";
    ci = "done";
  }
  return {
    kind: "reviewFix",
    anchor: "review",
    head: "レビューの指摘",
    rows: [
      { label: "指摘あり", state: "failed" },
      { label: "修正", state: fix },
      { label: "CIに戻る", state: ci },
    ],
    returnLine: status.fixCount > 0 || stage === "fixing",
  };
}

function mergeHoldBranch(labels: Set<string>, stage: BaseStage): ExtraBranch | null {
  if (!labels.has(LABEL.hold)) return null;
  const merged = MERGED_STAGES.includes(stage);
  if (stage !== "mergeWaiting" && !merged) return null;
  return {
    kind: "mergeHold",
    anchor: "fix",
    head: "マージ",
    rows: [{ label: "人間のマージ待ち", state: merged ? "done" : "waiting" }],
    returnLine: false,
  };
}

function stuckBranch(status: FlowStatus): ExtraBranch | null {
  if (status.stage !== "stuck") return null;
  const flow = getFlow(status);
  return {
    kind: "stuck",
    anchor: flow.steps[flow.at].key,
    head: "止まった",
    rows: [{ label: "Your turn", state: "waiting" }],
    returnLine: false,
  };
}

function designMark(status: FlowStatus, facts: FlowFacts, stepLog: readonly StepInfo[] | null): DesignMark {
  if (facts.mocks || stepLog?.some((info) => info.key === "design")) return "made";
  // 実装より下まで進んでいて、進捗ログに画面案の記録が無い：画面案を通らなかった
  const implement = 2;
  if (stepLog && stepLog.length > 0 && getFlow(status).at >= implement) return "skipped";
  return null;
}

/** 進捗図の、CI失敗時の分岐以外の枝と、デザインの行の扱いを決める（docs/spec.md の「ほかの分岐」） */
export function getFlowExtras({ status, facts, stepLog }: FlowExtrasInput): FlowExtras {
  const stage = baseStage(status);
  const labels = new Set([...facts.labels, ...(status.pull?.labels ?? [])]);
  const branches = [
    waitBranch(labels, stage),
    critiqueBranch(status),
    reviewFixBranch(status, facts, stage),
    mergeHoldBranch(labels, stage),
    stuckBranch(status),
  ].filter((branch): branch is ExtraBranch => branch !== null);
  return { branches, design: designMark(status, facts, stepLog) };
}

/** 枠の中の1行の読み上げ（`質問待ち　待ち`） */
export function extraRowLabel(row: ExtraBranchRow): string {
  return `${row.label}　${FLOW_STATE_LABEL[row.state]}`;
}
