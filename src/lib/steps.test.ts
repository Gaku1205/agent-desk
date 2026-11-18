import { describe, expect, it } from "vitest";
import { appendStep, gatherSteps, mapSteps, type Step, type StepSource } from "./steps";

/** 手で進める時計：`advance(ms)` で、その時刻までの待ちと取得を終わらせる */
function fakeClock() {
  let now = 0;
  const timers: { at: number; run: () => void }[] = [];
  const at = (ms: number) => new Promise<void>((resolve) => timers.push({ at: now + ms, run: resolve }));
  const flush = async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  };
  return {
    wait: at,
    /** ms 後に value で終わる取得 */
    after: <T>(ms: number, value: T) => at(ms).then(() => value),
    async advance(ms: number) {
      const until = now + ms;
      for (;;) {
        await flush();
        const due = timers.filter((timer) => timer.at <= until).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        timers.splice(timers.indexOf(due), 1);
        now = due.at;
        due.run();
      }
      now = until;
      await flush();
    },
  };
}

const OPTIONS = { deadlineMs: 100, graceMs: 100, batchMs: 200 };

/** 届いた段を順に集める */
function collect<T>(first: Promise<Step<T>>): T[] {
  const seen: T[] = [];
  const follow = (step: Step<T>): void => {
    seen.push(step.value);
    void step.next?.then(follow);
  };
  void first.then(follow);
  return seen;
}

describe("覚えている物をすぐ出し、読めた所から順に入れ替える", () => {
  it("全部がすぐ読めれば、新しい結果だけの段を1つ出して終わる（古い結果は読まない）", async () => {
    const clock = fakeClock();
    let staleReads = 0;
    const sources: StepSource<string>[] = ["a", "b"].map((name) => ({
      fresh: clock.after(10, `${name}-new`),
      stale: async () => {
        staleReads++;
        return `${name}-old`;
      },
    }));
    const seen = collect(gatherSteps(sources, { ...OPTIONS, wait: clock.wait }));
    await clock.advance(50);
    expect(seen).toEqual([{ results: ["a-new", "b-new"], staleCount: 0, missingCount: 0 }]);
    expect(staleReads).toBe(0);
  });

  it("新しい結果が遅い所は、覚えている古い結果を先に出し、届いたら入れ替える", async () => {
    const clock = fakeClock();
    const sources: StepSource<string>[] = [
      { fresh: clock.after(10, "a-new"), stale: async () => "a-old" },
      { fresh: clock.after(5000, "b-new"), stale: () => clock.after(20, "b-old") },
    ];
    const seen = collect(gatherSteps(sources, { ...OPTIONS, wait: clock.wait }));
    await clock.advance(99);
    expect(seen).toEqual([]);
    await clock.advance(30);
    expect(seen).toEqual([{ results: ["a-new", "b-old"], staleCount: 1, missingCount: 0 }]);
    await clock.advance(6000);
    expect(seen.at(-1)).toEqual({ results: ["a-new", "b-new"], staleCount: 0, missingCount: 0 });
    expect(seen).toHaveLength(2);
  });

  it("覚えている物が無い所は空けたまま出し、読めた順に（まとめて）足す", async () => {
    const clock = fakeClock();
    const sources: StepSource<string>[] = [
      { fresh: clock.after(10, "a"), stale: async () => null },
      { fresh: clock.after(1000, "b"), stale: async () => null },
      { fresh: clock.after(1100, "c"), stale: async () => null },
      { fresh: clock.after(3000, "d"), stale: async () => null },
    ];
    const seen = collect(gatherSteps(sources, { ...OPTIONS, wait: clock.wait }));
    await clock.advance(250);
    expect(seen).toEqual([{ results: ["a", null, null, null], staleCount: 0, missingCount: 3 }]);
    // 1000ms の b のあと 200ms まとめるので、1100ms の c も同じ段に入る
    await clock.advance(1000);
    expect(seen.at(-1)).toEqual({ results: ["a", "b", "c", null], staleCount: 0, missingCount: 1 });
    expect(seen).toHaveLength(2);
    await clock.advance(2000);
    expect(seen.at(-1)).toEqual({ results: ["a", "b", "c", "d"], staleCount: 0, missingCount: 0 });
    expect(seen).toHaveLength(3);
  });

  it("出せる物が1つも無い間は、段を出さない（空の中身を出さない）", async () => {
    const clock = fakeClock();
    const sources: StepSource<string>[] = [
      { fresh: clock.after(900, "a"), stale: async () => null },
      { fresh: clock.after(950, "b"), stale: async () => null },
    ];
    const seen = collect(gatherSteps(sources, { ...OPTIONS, wait: clock.wait }));
    await clock.advance(800);
    expect(seen).toEqual([]);
    await clock.advance(110);
    expect(seen).toEqual([{ results: ["a", null], staleCount: 0, missingCount: 1 }]);
    await clock.advance(100);
    expect(seen.at(-1)).toEqual({ results: ["a", "b"], staleCount: 0, missingCount: 0 });
  });

  it("古い結果を読むのが遅い・失敗しても、待つ上限で出す。新しい結果が届いた所は古い結果に戻さない", async () => {
    const clock = fakeClock();
    const sources: StepSource<string>[] = [
      { fresh: clock.after(10, "a-new"), stale: async () => "a-old" },
      { fresh: clock.after(150, "b-new"), stale: () => clock.after(400, "b-old") },
      {
        fresh: clock.after(5000, "c-new"),
        stale: async () => {
          throw new Error("failed");
        },
      },
    ];
    const seen = collect(gatherSteps(sources, { ...OPTIONS, wait: clock.wait }));
    await clock.advance(210);
    expect(seen[0]).toEqual({ results: ["a-new", "b-new", null], staleCount: 0, missingCount: 1 });
    await clock.advance(1000);
    expect(seen).toHaveLength(1);
    await clock.advance(5000);
    expect(seen.at(-1)).toEqual({ results: ["a-new", "b-new", "c-new"], staleCount: 0, missingCount: 0 });
  });

  it("取得元が無ければ、空の段を1つ", async () => {
    const clock = fakeClock();
    const step = await gatherSteps<string>([], { ...OPTIONS, wait: clock.wait });
    expect(step).toEqual({ value: { results: [], staleCount: 0, missingCount: 0 }, next: null });
  });
});

describe("段の列を変える", () => {
  const two: Step<number> = { value: 1, next: Promise.resolve({ value: 2, next: null }) };

  it("mapSteps は、どの段も変える。最後の段かどうかを渡す", async () => {
    const mapped = await mapSteps(two, (value, isLast) => `${value}${isLast ? "!" : ""}`);
    expect(mapped.value).toBe("1");
    expect(await mapped.next).toEqual({ value: "2!", next: null });
  });

  it("appendStep は、最後の段のあとにもう1段足す。投げたら、最後の段のまま終わる", async () => {
    const added = appendStep(two, async () => 3);
    const second = await added.next;
    expect(second?.value).toBe(2);
    expect(await second?.next).toEqual({ value: 3, next: null });

    const failed = appendStep({ value: 1, next: null }, async () => {
      throw new Error("failed");
    });
    expect(await failed.next).toEqual({ value: 1, next: null });
  });
});
