import { describe, expect, it } from "vitest";
import type { ParallelSettings, ParallelState } from "../parallel";
import { assignSlots, freeSlotReason, lanesHeadline, overLimitNote, queueReasonText, type QueueEntry } from "./slots";
import type { LanesSource, QueueSource, RunEntry, SlotWork } from "./source";

function work(number: number): SlotWork {
  return {
    key: `o/r#${number}`,
    owner: "o",
    repo: "r",
    number,
    title: `作業 ${number}`,
    url: `https://github.com/o/r/issues/${number}`,
    stepText: "実装しています",
    stepAt: 2,
    stepName: "実装",
    elapsedMs: null,
    ci: null,
    touches: null,
  };
}

function waiting(number: number, cause: QueueSource["cause"] = null, file: string | null = null): QueueSource {
  return {
    key: `o/r#${number}`,
    owner: "o",
    repo: "r",
    number,
    title: `待ち ${number}`,
    url: `https://github.com/o/r/issues/${number}`,
    cause,
    file,
    waitFor: null,
    waitFors: [],
    waitingMs: null,
  };
}

function source(works: SlotWork[], queue: QueueSource[]): LanesSource {
  return { works, queue, runs: [], paused: [] };
}

describe("assignSlots", () => {
  it("動いている作業を上の枠から詰め、残りを空きの枠にする", () => {
    const lanes = assignSlots(source([work(1), work(2)], []), 3);
    expect(lanes.slots.map((slot) => [slot.index, slot.kind])).toEqual([
      [1, "running"],
      [2, "running"],
      [3, "free"],
    ]);
    expect(lanes.counts).toEqual({ running: 2, runs: 0, free: 1, queue: 0 });
  });

  it("上限より多く動いていれば、動いている数だけ（空きは0）", () => {
    const lanes = assignSlots(source([work(1), work(2)], []), 1);
    expect(lanes.slots).toHaveLength(2);
    expect(lanes.counts.free).toBe(0);
  });

  it("上限が分からなければ、動いている数だけ出し、空きは出さない", () => {
    const lanes = assignSlots(source([work(1)], [waiting(5)]), null);
    expect(lanes.slots).toHaveLength(1);
    expect(lanes.counts.free).toBeNull();
  });

  it("Queue の順に番号を付け、空きがあれば理由の無い物は「次の見直しで入る」", () => {
    const lanes = assignSlots(source([work(1)], [waiting(5, "overlap", "src/a.ts"), waiting(6)]), 3);
    expect(lanes.queue.map((entry) => [entry.rank, entry.number, entry.reason])).toEqual([
      [1, 5, "触るファイルが重なる（src/a.ts）"],
      [2, 6, "次の見直しで入る"],
    ]);
    const free = lanes.slots.find((slot) => slot.kind === "free");
    expect(free?.kind === "free" && free.next).toEqual({ owner: "o", repo: "r", number: 5 });
    expect(free?.kind === "free" && free.reason).toBe("次に r#6 が入ります");
  });

  it("空きが無ければ、理由の無い物は「席が空くのを待っている」", () => {
    const lanes = assignSlots(source([work(1)], [waiting(5)]), 1);
    expect(lanes.queue[0].reason).toBe("席が空くのを待っている");
  });

  it("処理を席にぶら下げ、残りを other に。処理の合計は両方の和", () => {
    const run = (id: string, issueNumber: number | null): RunEntry => ({
      key: `o/r@${id}`,
      kind: "Implement",
      owner: "o",
      repo: "r",
      issueNumber,
      pullNumber: null,
      activity: null,
      detail: null,
      elapsedMs: null,
      logUrl: null,
      startedMs: 1,
      sleeping: false,
      wakeAtMs: null,
      jobs: null,
    });
    const lanes = assignSlots({ works: [work(1), work(2)], queue: [], runs: [run("a", 1), run("b", null), run("c", 7)], paused: [] }, 3);
    const [first, second, free] = lanes.slots;
    expect(first.kind === "running" && first.runs.map((r) => r.key)).toEqual(["o/r@a"]);
    expect(second.kind === "running" && second.runs).toEqual([]);
    expect(free.kind).toBe("free");
    expect(lanes.other.map((r) => r.key)).toEqual(["o/r@b", "o/r@c"]);
    expect(lanes.counts.runs).toBe(3);
    expect(lanes.counts.running).toBe(2);
  });
});

function entry(kind: QueueEntry["reasonKind"]): QueueEntry {
  return { ...waiting(1), rank: 1, reasonKind: kind, reason: queueReasonText(kind, null) };
}

describe("freeSlotReason", () => {
  it("待つ物が無ければ「順番待ちなし」", () => {
    expect(freeSlotReason([])).toBe("順番待ちなし");
  });

  it("全部が触るファイルの重なりなら、そう言う", () => {
    expect(freeSlotReason([entry("overlap"), entry("hold"), entry("overlap")])).toBe("3件ともファイルが重なり待ち");
  });

  it("全部がほかの作業の完了待ちなら、そう言う。1件なら「とも」を付けない", () => {
    expect(freeSlotReason([entry("blocked")])).toBe("1件は前の作業の完了待ち");
    expect(freeSlotReason([entry("overlap")])).toBe("1件はファイルが重なり待ち");
    expect(freeSlotReason([entry("blocked"), entry("blocked")])).toBe("2件とも前の作業の完了待ち");
  });

  it("まざっていれば、まとめて言う", () => {
    expect(freeSlotReason([entry("blocked"), entry("noTouches")])).toBe("2件とも前の作業待ち");
  });
});

describe("queueReasonText", () => {
  it("理由ごとの文", () => {
    expect(queueReasonText("hold", "src/a.ts")).toBe("マージ待ちの PR と触るファイルが重なる（src/a.ts）");
    expect(queueReasonText("hold", null)).toBe("マージ待ちの PR と触るファイルが重なる");
    expect(queueReasonText("noTouches", null)).toBe("触るファイルの印が無いので、動いている作業が終わるまで待つ");
    expect(queueReasonText("unknownInflight", null)).toBe("動いている作業の触るファイルが分からないので、終わるまで待つ");
  });
});

describe("lanesHeadline", () => {
  const now = new Date("2026-11-18T02:13:00Z"); // 日本時間 11:13
  const settings: ParallelSettings = { day: 3, night: 1, nightHours: { start: 23, end: 7 } };
  const state: ParallelState = { period: "day", limit: 3, override: null };

  it("昼：今の数 → 夜になる時刻と夜の数", () => {
    expect(lanesHeadline(now, settings, state)).toBe("11:13 · 3件まで同時に · 23:00 から 1件ずつ");
    expect(lanesHeadline(now, { ...settings, night: 2 }, state)).toBe("11:13 · 3件まで同時に · 23:00 から 2件まで同時に");
  });

  it("夜：今の数 → 昼になる時刻と昼の数。状態が無ければ時間帯の決まりで決める", () => {
    const night = new Date("2026-11-18T17:33:00Z"); // 日本時間 02:33
    const nightState: ParallelState = { period: "night", limit: 1, override: null };
    expect(lanesHeadline(night, settings, nightState)).toBe("02:33 · 夜は 1件ずつ · 7:00 から 3件まで同時に");
    expect(lanesHeadline(night, settings, null)).toBe("02:33 · 夜は 1件ずつ · 7:00 から 3件まで同時に");
  });

  it("夜の時間帯が無ければ昼の数だけ。設定が分からなければ時刻だけ", () => {
    expect(lanesHeadline(now, { ...settings, nightHours: null }, state)).toBe("11:13 · 3件まで同時に");
    expect(lanesHeadline(now, null, null)).toBe("11:13");
  });

  it("手の上書きが効いていれば、その時間帯の文に「手動」を添える", () => {
    const manual: ParallelState = { period: "night", limit: 1, override: { period: "night", until: new Date() } };
    expect(lanesHeadline(now, settings, manual)).toBe("11:13 · 夜は 1件ずつ · 7:00 から 3件まで同時に · 手動");
  });
});

describe("overLimitNote：上限より多く動いている一文", () => {
  it("上限より多いときだけ出す", () => {
    expect(overLimitNote(5, 1)).toBe(
      "上限（1件）より多く動いています。上限は、新しく始める数だけを決めます。もう動いている作業は止めません。",
    );
  });

  it("上限以内・上限が読めないときは出さない", () => {
    expect(overLimitNote(1, 1)).toBeNull();
    expect(overLimitNote(0, 3)).toBeNull();
    expect(overLimitNote(5, null)).toBeNull();
  });
});
