import { formatEventTime } from "../events";
import { currentPeriod, type ParallelSettings, type ParallelState } from "../parallel";
import { attachRuns } from "./attach";
import type { LanesSource, QueueCause, QueueSource, RunEntry, SlotWork } from "./source";

/**
 * Slots & Queue の、枠の数（今の並列の上限）から決まる物（docs/spec.md の「Slots & Queue」）：
 * 枠の割り当て、空き枠の数と理由、Queue の最終の理由、見出しの数と一文
 */

/** 次に入る物（空きの枠の右に出す） */
export type SlotNext = { owner: string; repo: string; number: number };

export type Slot =
  | { index: number; kind: "running"; work: SlotWork; runs: RunEntry[] }
  | { index: number; kind: "free"; reason: string; next: SlotNext | null };

/** 最終の待つ理由（枠の数で決まる `full`・`ready` を足した物） */
export type QueueReasonKind = QueueCause | "full" | "ready";

export type QueueEntry = QueueSource & {
  /** 次に入る順（1始まり。全部のリポジトリを通した順） */
  rank: number;
  reasonKind: QueueReasonKind;
  /** 待つ理由の文（`触るファイルが重なる（src/a.ts）`。待つ相手は `waitFor` で別に出す） */
  reason: string;
};

export type LanesCounts = {
  running: number;
  /** 動いている処理の合計（席にぶら下がる分＋Other の分） */
  runs: number;
  /** 空きの枠の数。上限が分からないときは null（出さない） */
  free: number | null;
  queue: number;
};

export type Lanes = {
  slots: Slot[];
  queue: QueueEntry[];
  /** 席に属さない処理（Other） */
  other: RunEntry[];
  counts: LanesCounts;
};

/** 待つ理由の文 */
export function queueReasonText(kind: QueueReasonKind, file: string | null): string {
  const withFile = file ? `（${file}）` : "";
  switch (kind) {
    case "blocked":
      return "ほかの作業の完了を待っている";
    case "hold":
      return `マージ待ちの PR と触るファイルが重なる${withFile}`;
    case "noTouches":
      return "触るファイルの印が無いので、動いている作業が終わるまで待つ";
    case "overlap":
      return `触るファイルが重なる${withFile}`;
    case "unknownInflight":
      return "動いている作業の触るファイルが分からないので、終わるまで待つ";
    case "full":
      return "席が空くのを待っている";
    case "ready":
      return "次の見直しで入る";
  }
}

/** 空きの枠の理由 */
export function freeSlotReason(queue: readonly QueueEntry[]): string {
  if (queue.length === 0) return "順番待ちなし";
  const ready = queue.find((entry) => entry.reasonKind === "ready");
  if (ready) return `次に ${ready.repo}#${ready.number} が入ります`;
  const head = queue.length === 1 ? "1件は" : `${queue.length}件とも`;
  if (queue.every((entry) => entry.reasonKind === "overlap" || entry.reasonKind === "hold")) {
    return `${head}ファイルが重なり待ち`;
  }
  if (queue.every((entry) => entry.reasonKind === "blocked")) {
    return `${head}前の作業の完了待ち`;
  }
  return `${head}前の作業待ち`;
}

/**
 * 枠を割り当てる。limit は今の並列の上限（分からなければ null）。
 * 動いている作業を上の枠から詰め、残りは空きの枠。上限より多く動いていれば動いている数だけ（空きは0）。
 * 上限が分からなければ、動いている数だけ出し、空きは出さない
 */
export function assignSlots(source: LanesSource, limit: number | null): Lanes {
  const free = limit === null ? null : Math.max(limit - source.works.length, 0);
  const queue: QueueEntry[] = source.queue.map((entry, index) => {
    const reasonKind: QueueReasonKind = entry.cause ?? (free !== null && free > 0 ? "ready" : "full");
    return { ...entry, rank: index + 1, reasonKind, reason: queueReasonText(reasonKind, entry.file) };
  });
  const first = queue[0];
  const next: SlotNext | null = first ? { owner: first.owner, repo: first.repo, number: first.number } : null;
  const reason = freeSlotReason(queue);
  const attached = attachRuns(source.works, source.runs);
  const slots: Slot[] = source.works.map((work, index) => ({
    index: index + 1,
    kind: "running",
    work,
    runs: attached.bySlot[work.key] ?? [],
  }));
  for (let i = 0; i < (free ?? 0); i += 1) {
    slots.push({ index: slots.length + 1, kind: "free", reason, next });
  }
  return {
    slots,
    queue,
    other: attached.other,
    counts: { running: source.works.length, runs: source.runs.length, free, queue: queue.length },
  };
}

/**
 * 上限より多く動いているときの一文（Slots の見出しの下）。上限以内・上限が分からないときは null
 */
export function overLimitNote(running: number, limit: number | null): string | null {
  if (limit === null || running <= limit) return null;
  return `上限（${limit}件）より多く動いています。上限は、新しく始める数だけを決めます。もう動いている作業は止めません。`;
}

/** 数を `3件まで同時に`・`1件ずつ`（1のとき）に */
function countText(n: number): string {
  return n === 1 ? "1件ずつ" : `${n}件まで同時に`;
}

/**
 * 見出しの下の一文。今どうか → 次にいつ変わるか の順：
 * 昼 `14:10 · 5件まで同時に · 23:00 から 1件ずつ`、夜 `02:33 · 夜は 1件ずつ · 7:00 から 5件まで同時に`。
 * 夜の時間帯が無ければ `14:10 · 5件まで同時に`、設定が分からなければ `14:10`。上書き中は ` · 手動`。
 * 昼か夜かは今の状態（上書きを含む）に従い、無ければ時間帯の決まりで決める
 */
export function lanesHeadline(now: Date, settings: ParallelSettings | null, state: ParallelState | null): string {
  const at = formatEventTime(now.toISOString());
  if (!settings) return at;
  const manual = state?.override ? " · 手動" : "";
  if (!settings.nightHours) return `${at} · ${countText(settings.day)}${manual}`;
  const { start, end } = settings.nightHours;
  const period = state?.period ?? currentPeriod(now, settings.nightHours);
  if (period === "night") {
    return `${at} · 夜は ${countText(settings.night)} · ${end % 24}:00 から ${countText(settings.day)}${manual}`;
  }
  return `${at} · ${countText(settings.day)} · ${start % 24}:00 から ${countText(settings.night)}${manual}`;
}
