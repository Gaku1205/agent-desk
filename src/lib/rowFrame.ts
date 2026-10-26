import type { IssueStatus, Stage } from "./status";

/** パイプライン表の行の外枠：回す（AIが動いている）／止まっている（色の種類）／出さない */
export type RowFrame =
  | { kind: "spinning" }
  | { kind: "stopped"; color: "human" | "fail" }
  | { kind: "queue" }
  | { kind: "none" };

const NONE: RowFrame = { kind: "none" };
const QUEUE: RowFrame = { kind: "queue" };
const SPINNING: RowFrame = { kind: "spinning" };

/** 段階ごとの外枠。失敗は誰の番かより優先して `--fail` にする */
const FRAME_BY_STAGE: Record<Stage, RowFrame> = {
  planning: SPINNING,
  implementing: SPINNING,
  ciRunning: SPINNING,
  reviewing: SPINNING,
  fixing: SPINNING,
  deploying: SPINNING,
  stuck: { kind: "stopped", color: "human" },
  retrying: QUEUE, // 人間は何もしなくてよいので、順番待ちと同じ控えめな枠
  prWaiting: { kind: "stopped", color: "human" },
  mergeWaiting: NONE, // 人間の番（ai:hold）のときだけ下で human にする
  ciFailed: { kind: "stopped", color: "fail" },
  deployFailed: { kind: "stopped", color: "fail" },
  deployed: NONE,
  queued: QUEUE,
  notStarted: { kind: "stopped", color: "human" },
};

/** 行にどの外枠を出すか */
export function rowFrame(status: Pick<IssueStatus, "stage" | "turn">): RowFrame {
  if (status.stage === "mergeWaiting" && status.turn === "human") {
    return { kind: "stopped", color: "human" };
  }
  return FRAME_BY_STAGE[status.stage];
}

/** 行の `data-frame` に入れる値（外枠を出さないときは undefined） */
export function rowFrameAttr(frame: RowFrame): "spinning" | "human" | "fail" | "queue" | undefined {
  if (frame.kind === "none") return undefined;
  if (frame.kind === "queue") return "queue";
  return frame.kind === "spinning" ? "spinning" : frame.color;
}
