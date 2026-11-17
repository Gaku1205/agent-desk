import { describe, expect, it } from "vitest";
import type { ChatMessage } from "./conversation";
import type { Lamp } from "./lamp";
import { splitQueue } from "./queueGroup";

function msg(repo: string, number: number, stage: string, lamp: Lamp = { kind: "none" }): ChatMessage {
  return { key: `o/${repo}#${number}`, owner: "o", repo, number, stage, lamp } as ChatMessage;
}

const keys = (list: ChatMessage[]) => list.map((m) => m.key);

describe("splitQueue", () => {
  it("順番待ちが0件なら、まとまりは空で、ほかはそのまま", () => {
    const all = [msg("a", 2, "implementing"), msg("a", 1, "ciRunning")];
    const { queue, rest } = splitQueue(all, ["o/a"]);
    expect(queue).toEqual([]);
    expect(rest).toEqual(all);
  });

  it("順番待ちを分け、動いている作業の並びは変えない", () => {
    const { queue, rest } = splitQueue([
      msg("a", 5, "implementing"),
      msg("a", 3, "queued", { kind: "waiting", position: 1 }),
      msg("a", 4, "reviewing"),
    ]);
    expect(keys(queue)).toEqual(["o/a#3"]);
    expect(keys(rest)).toEqual(["o/a#5", "o/a#4"]);
  });

  it("リポジトリごとの待ち順（急ぎ・ai:blocked の混在）で並べる", () => {
    const { queue } = splitQueue(
      [
        msg("a", 9, "queued", { kind: "waiting", position: 3 }), // ai:blocked
        msg("a", 8, "queued", { kind: "waiting", position: 2 }),
        msg("a", 20, "queued", { kind: "waiting", position: 1 }), // 急ぎ
      ],
      ["o/a"],
    );
    expect(keys(queue)).toEqual(["o/a#20", "o/a#8", "o/a#9"]);
  });

  it("リポジトリが違えば、リポジトリの並びの順", () => {
    const { queue } = splitQueue(
      [
        msg("b", 1, "queued", { kind: "waiting", position: 1 }),
        msg("a", 7, "queued", { kind: "waiting", position: 2 }),
        msg("a", 6, "queued", { kind: "waiting", position: 1 }),
      ],
      ["o/b", "o/a"],
    );
    expect(keys(queue)).toEqual(["o/b#1", "o/a#6", "o/a#7"]);
  });

  it("並びに無いリポジトリは後ろ、待ち順が無い物はさらに後ろに番号順", () => {
    const { queue } = splitQueue(
      [
        msg("z", 1, "queued", { kind: "waiting", position: 1 }),
        msg("a", 5, "queued"),
        msg("a", 4, "queued"),
        msg("a", 9, "queued", { kind: "waiting", position: 1 }),
      ],
      ["o/a"],
    );
    expect(keys(queue)).toEqual(["o/a#9", "o/a#4", "o/a#5", "o/z#1"]);
  });
});
