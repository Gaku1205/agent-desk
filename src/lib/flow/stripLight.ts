import type { FlowNode, FlowWho } from "./nodes";

/**
 * スマホの帯の光（docs/design.md の「スマホ」）：列の中の Issue → 色・芯の大きさ・粒の数。
 * 各列は1つの光・1色。色はその列でいちばん目立つ物（人間 → 失敗 → AI → 待機 → 公開済み）
 */
export type StripLight = {
  /** 光の色（0件なら null。筋の上に小さな点だけ） */
  who: FlowWho | null;
  /** 芯の大きさ（px） */
  core: number;
  /** 芯のまわりを回る同じ色の粒の数 */
  grains: number;
  /** 急ぐ物（止まった・公開失敗）がある列だけ、にじみを大きくする */
  urgent: boolean;
};

const LEAD_ORDER: FlowWho[] = ["human", "fail", "ai", "queue", "done"];

/** 粒の数の基本（以前の列の塊の1.5倍） */
const BASE_GRAINS: Record<FlowWho, number> = { human: 39, fail: 24, ai: 36, queue: 24, done: 30 };
/** 2件目からの1件ぶんの粒と、増やす上限 */
const GRAINS_PER_EXTRA = 2;
const GRAINS_EXTRA_MAX = 12;

/** 件数に応じた芯の大きさ：1件 4px・2〜3件 5px・4〜6件 6px・7件以上 7px */
export function stripCoreSize(count: number): number {
  if (count >= 7) return 7;
  if (count >= 4) return 6;
  if (count >= 2) return 5;
  return 4;
}

export function stripLight(members: Pick<FlowNode, "who" | "urgent">[]): StripLight {
  const who = LEAD_ORDER.find((w) => members.some((m) => m.who === w)) ?? null;
  if (!who) return { who: null, core: 0, grains: 0, urgent: false };
  const extra = Math.min(GRAINS_EXTRA_MAX, (members.length - 1) * GRAINS_PER_EXTRA);
  return {
    who,
    core: stripCoreSize(members.length),
    grains: BASE_GRAINS[who] + extra,
    urgent: members.some((m) => m.urgent),
  };
}
