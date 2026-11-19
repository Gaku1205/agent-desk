import type { QueueReasonKind } from "./slots";
import type { WaitTarget } from "./source";

/**
 * Queue の行の2行目（docs/spec.md の「待つ理由と相手」）：待っている相手の作業だけを出す。
 * ファイル名などの細かい理由は出さない（行の `title` に残す）
 */
export type QueueLine =
  | { kind: "target"; target: WaitTarget; /** 相手の残り（`ほか2件` の 2） */ more: number }
  | { kind: "text"; text: string };

export const SEAT_LINE = "席が空くのを待っています";
export const UNKNOWN_LINE = "動いている作業が終わるのを待っています";
export const READY_LINE = "次の見直しで入ります";

/** いちばん早く終わりそうな相手：動いている物が先、次に番号の小さい物（PR は Issue のあと） */
export function firstTarget(targets: readonly WaitTarget[]): WaitTarget | null {
  const sorted = [...targets].sort(
    (a, b) =>
      Number(b.running) - Number(a.running) ||
      Number(a.kind === "pull") - Number(b.kind === "pull") ||
      a.number - b.number,
  );
  return sorted[0] ?? null;
}

export function queueLine(entry: { reasonKind: QueueReasonKind; waitFors: readonly WaitTarget[] }): QueueLine {
  if (entry.reasonKind === "full") return { kind: "text", text: SEAT_LINE };
  if (entry.reasonKind === "ready") return { kind: "text", text: READY_LINE };
  const target = firstTarget(entry.waitFors);
  if (target === null) return { kind: "text", text: UNKNOWN_LINE };
  return { kind: "target", target, more: entry.waitFors.length - 1 };
}
