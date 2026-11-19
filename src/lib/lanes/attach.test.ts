import { describe, expect, it } from "vitest";
import { attachRuns } from "./attach";
import type { RunEntry, SlotWork } from "./source";

function work(number: number, repo = "r"): SlotWork {
  return {
    key: `o/${repo}#${number}`,
    owner: "o",
    repo,
    number,
    title: `作業 ${number}`,
    url: "",
    stepText: "実装しています",
    stepAt: 2,
    stepName: "実装",
    elapsedMs: null,
    ci: null,
    touches: null,
  };
}

function run(id: string, issueNumber: number | null, startedMs: number | null = 1000, repo = "r"): RunEntry {
  return {
    key: `o/${repo}@${id}`,
    kind: "Implement",
    owner: "o",
    repo,
    issueNumber,
    pullNumber: null,
    activity: null,
    detail: null,
    elapsedMs: null,
    logUrl: null,
    startedMs,
    sleeping: false,
    wakeAtMs: null,
    jobs: null,
  };
}

describe("attachRuns", () => {
  it("Issue の番号が席の作業と同じ処理を、その席にぶら下げる", () => {
    const { bySlot, other } = attachRuns([work(1), work(2)], [run("a", 2), run("b", 1)]);
    expect(bySlot["o/r#1"].map((r) => r.key)).toEqual(["o/r@b"]);
    expect(bySlot["o/r#2"].map((r) => r.key)).toEqual(["o/r@a"]);
    expect(other).toEqual([]);
  });

  it("番号が分からない処理と、席に無い Issue の処理は other", () => {
    const { bySlot, other } = attachRuns([work(1)], [run("w", null), run("x", 9)]);
    expect(bySlot).toEqual({});
    expect(other.map((r) => r.key)).toEqual(["o/r@w", "o/r@x"]);
  });

  it("処理が無い席・空き席にはキーを作らない", () => {
    const { bySlot } = attachRuns([work(1), work(2)], [run("a", 1)]);
    expect(Object.keys(bySlot)).toEqual(["o/r#1"]);
  });

  it("別のリポジトリの同じ番号は付けない", () => {
    const { bySlot, other } = attachRuns([work(1, "r")], [run("a", 1, 1000, "other")]);
    expect(bySlot).toEqual({});
    expect(other).toHaveLength(1);
  });

  it("1つの席に複数あれば、始まった時刻の古い順（時刻が無いのは最後）", () => {
    const { bySlot } = attachRuns([work(1)], [run("late", 1, 3000), run("none", 1, null), run("early", 1, 1000)]);
    expect(bySlot["o/r#1"].map((r) => r.key)).toEqual(["o/r@early", "o/r@late", "o/r@none"]);
  });
});
