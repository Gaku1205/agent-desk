import type { IssueStatus, Stage } from "./status";

/** 棒の名前（i = 0〜7） */
export const PROGRESS_STAGE_NAMES = [
  "清書",
  "実装",
  "PR",
  "CI",
  "レビュー",
  "修正",
  "マージ",
  "公開",
] as const;

export type ProgressTone = "human" | "ai" | "done" | "fail" | "queue";

export type ProgressBarSpec = {
  /** 棒の番号（0〜7） */
  index: number;
  name: string;
  /** 色の種類。まだの段階は null（`PENDING_COLOR` で塗る） */
  tone: ProgressTone | null;
  /** 不透明度（まだの段階は 1） */
  opacity: number;
  /** 飛ばした段階：塗らずに枠線だけ */
  outlineOnly: boolean;
  /** 今の段階の棒 */
  current: boolean;
};

export type Progress = {
  /** 今の位置（0〜7） */
  at: number;
  tone: ProgressTone;
  bars: ProgressBarSpec[];
  /** 今の段階の名前（公開済みは「公開済み」） */
  currentName: string;
  /** `role="img"` の `aria-label` */
  ariaLabel: string;
};

/** まだの段階の棒の色 */
export const PENDING_COLOR = "#1C1D21";

const TONE_RGB: Record<ProgressTone, string> = {
  human: "232,163,61",
  ai: "94,155,247",
  done: "76,195,138",
  fail: "242,85,90",
  queue: "139,92,246",
};

/** 色の種類と不透明度から `rgba(...)` を作る */
export function toneRgba(tone: ProgressTone, opacity: number): string {
  return `rgba(${TONE_RGB[tone]},${opacity})`;
}

const AT_BY_STAGE: Record<Exclude<Stage, "stuck">, number> = {
  notStarted: 0,
  queued: 0,
  skipped: 0,
  planning: 0,
  implementing: 1,
  prWaiting: 2,
  ciRunning: 3,
  ciFailed: 3,
  reviewing: 4,
  fixing: 5,
  mergeWaiting: 6,
  deploying: 7,
  deployFailed: 7,
  deployed: 7,
};

const TONE_BY_STAGE: Record<Exclude<Stage, "stuck" | "mergeWaiting">, ProgressTone> = {
  notStarted: "human",
  queued: "queue",
  skipped: "human",
  planning: "ai",
  implementing: "ai",
  prWaiting: "human",
  ciRunning: "ai",
  ciFailed: "fail",
  reviewing: "ai",
  fixing: "ai",
  deploying: "ai",
  deployFailed: "fail",
  deployed: "done",
};

const FIX_INDEX = 5;
const MERGE_INDEX = 6;

/** 不透明度 `0.3 + 0.7 × i ÷ at`（`at` が0なら1）。小数第2位まで */
export function barOpacity(index: number, at: number): number {
  if (at === 0) return 1;
  return Math.round((0.3 + (0.7 * index) / at) * 100) / 100;
}

/** 段階から、8本の棒の色・不透明度・枠線だけかを決める（docs/design.md の「進み具合のバー」） */
export function getProgress(status: IssueStatus): Progress {
  const stage: Exclude<Stage, "stuck"> =
    status.stage === "stuck" ? (status.stageBeforeStuck ?? "notStarted") : status.stage;

  // 修正したあとのCI・レビューのやり直しは、「修正」の位置のまま
  const confirmingFix =
    status.verifyingFix && (stage === "ciRunning" || stage === "ciFailed" || stage === "reviewing");
  const at = confirmingFix ? FIX_INDEX : AT_BY_STAGE[stage];

  let tone: ProgressTone;
  if (status.stage === "stuck") tone = "human";
  else if (stage === "mergeWaiting") tone = status.turn === "human" ? "human" : "ai";
  else if (confirmingFix) tone = stage === "ciFailed" ? "fail" : "ai";
  else tone = TONE_BY_STAGE[stage];

  const skipPlan = !status.planned && at >= 1;
  const skipFix = status.fixCount === 0 && at >= MERGE_INDEX;

  const bars = PROGRESS_STAGE_NAMES.map((name, index): ProgressBarSpec => {
    const filled = index <= at;
    return {
      index,
      name,
      tone: filled ? tone : null,
      opacity: filled ? barOpacity(index, at) : 1,
      outlineOnly: filled && ((index === 0 && skipPlan) || (index === FIX_INDEX && skipFix)),
      current: index === at,
    };
  });

  const deployed = status.stage === "deployed";
  const currentName = deployed ? "公開済み" : PROGRESS_STAGE_NAMES[at];
  return {
    at,
    tone,
    bars,
    currentName,
    ariaLabel: `進み具合 ${deployed ? 8 : at}/8・${currentName}`,
  };
}
