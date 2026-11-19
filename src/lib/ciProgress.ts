import type { CheckRunData } from "./github/types";

/**
 * CI の進み具合（docs/spec.md の「Slots & Queue」の「使っている枠」）。
 * チェックランを 通過・実行中・枠待ち・失敗 に分けて数え、割合の線と1段目の文を決める
 */

/** チェックの種類（線の左からの並び） */
export type CiKind = "passed" | "running" | "queued" | "failed";

export const CI_KINDS: readonly CiKind[] = ["passed", "running", "queued", "failed"];

/** CI のチェックの件数（`total` は4つの合計） */
export type CiCounts = {
  passed: number;
  running: number;
  queued: number;
  failed: number;
  total: number;
};

/** 通過に数える結論。ほかの結論で完了した物は失敗 */
const PASSED_CONCLUSIONS = new Set(["success", "neutral", "skipped"]);

/** 1つのチェックランの種類 */
export function ciKindOf(check: Pick<CheckRunData, "status" | "conclusion">): CiKind {
  if (check.status === "completed") {
    return check.conclusion !== null && PASSED_CONCLUSIONS.has(check.conclusion) ? "passed" : "failed";
  }
  if (check.status === "in_progress") return "running";
  // `queued`・`waiting`・`pending`・`requested` など、まだ始まっていない物は枠待ち
  return "queued";
}

/** チェックランを種類ごとに数える（Claude Review を除くのは呼ぶ側） */
export function countCiChecks(checkRuns: readonly Pick<CheckRunData, "status" | "conclusion">[]): CiCounts {
  const counts: CiCounts = { passed: 0, running: 0, queued: 0, failed: 0, total: 0 };
  for (const check of checkRuns) {
    counts[ciKindOf(check)] += 1;
    counts.total += 1;
  }
  return counts;
}

/** 種類ごとの、読み上げの名前と文の記号 */
const KIND_NAME: Record<CiKind, string> = {
  passed: "通過",
  running: "実行中",
  queued: "枠待ち",
  failed: "失敗",
};

const KIND_MARK: Record<CiKind, string> = {
  passed: "✓",
  running: "◌",
  queued: "⧗",
  failed: "×",
};

export type CiSegment = {
  kind: CiKind;
  count: number;
  /** 全体に対する割合（0〜1） */
  ratio: number;
};

export type CiProgress = {
  counts: CiCounts;
  /** 線のまとまり（左から 通過・実行中・枠待ち・失敗。0件の種類は入れない） */
  segments: CiSegment[];
  /** いちばん右に添える言葉（失敗 → 枠待ち → 実行中 の順に、あれば先の物） */
  word: "失敗" | "枠待ち" | "実行中";
  /** 記号つきの数の文（`✓4 ⧗6`。0件の種類は出さない。チェックが無ければ空） */
  marks: string;
  /** 読み上げ（`CI 10件のうち 通過4件・枠待ち6件`） */
  label: string;
};

/** 件数の内訳（`IssueStatus.ci`。内訳の無い古い形は、残りを実行中とみなす） */
export type CiCountsInput = {
  passed: number;
  total: number;
  running?: number;
  queued?: number;
  failed?: number;
};

function normalize(input: CiCountsInput): CiCounts {
  const passed = Math.max(0, input.passed);
  const queued = Math.max(0, input.queued ?? 0);
  const failed = Math.max(0, input.failed ?? 0);
  const running =
    input.running !== undefined ? Math.max(0, input.running) : Math.max(0, input.total - passed - queued - failed);
  return { passed, running, queued, failed, total: passed + running + queued + failed };
}

/** 件数から、線のまとまり・1段目の文・読み上げを決める */
export function ciProgress(input: CiCountsInput): CiProgress {
  const counts = normalize(input);
  const present = CI_KINDS.filter((kind) => counts[kind] > 0);
  const segments = present.map((kind) => ({
    kind,
    count: counts[kind],
    ratio: counts.total === 0 ? 0 : counts[kind] / counts.total,
  }));
  const word = counts.failed > 0 ? "失敗" : counts.queued > 0 ? "枠待ち" : "実行中";
  const marks = present.map((kind) => `${KIND_MARK[kind]}${counts[kind]}`).join(" ");
  const label =
    counts.total === 0
      ? "CI のチェックはまだありません"
      : `CI ${counts.total}件のうち ${present.map((kind) => `${KIND_NAME[kind]}${counts[kind]}件`).join("・")}`;
  return { counts, segments, word, marks, label };
}

/** 1段目の文の全体（`4/7 CI ✓4 ⧗6 枠待ち`）。`stepAt` は7工程の今の位置（0から） */
export function ciStepText(stepAt: number, steps: number, progress: CiProgress): string {
  return [`${stepAt + 1}/${steps} CI`, progress.marks, progress.word].filter((part) => part !== "").join(" ");
}
