import { describe, expect, it } from "vitest";
import { formatServerTiming, instanceAgeMs, roundTimingMs, startStageTimer, timingName } from "./serverTiming";

describe("Server-Timing ヘッダー", () => {
  it("段の名前と ms を `名前;dur=ms` でつなぐ", () => {
    expect(
      formatServerTiming([
        { name: "auth", ms: 1.24 },
        { name: "watched", ms: 30 },
      ]),
    ).toBe("auth;dur=1.2, watched;dur=30");
  });

  it("段が無ければ空", () => {
    expect(formatServerTiming([])).toBe("");
  });

  it("名前は英小文字・数字・ハイフンだけにする（ヘッダーを壊す文字・秘密になりうる文字を入れない）", () => {
    expect(timingName("First Repo")).toBe("firstrepo");
    expect(timingName('a;dur=1, b="x"')).toBe("adur1bx");
    expect(timingName("owner/repo")).toBe("ownerrepo");
    expect(timingName("監視")).toBe("stage");
  });

  it("ms は小数1桁。負・数でない物は 0", () => {
    expect(roundTimingMs(12.345)).toBe(12.3);
    expect(roundTimingMs(-5)).toBe(0);
    expect(roundTimingMs(Number.NaN)).toBe(0);
    expect(roundTimingMs(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("段ごとの時間を測る", () => {
  /** 呼ぶたびに決まった時刻を返す時計 */
  function clock(times: number[]): () => number {
    let index = 0;
    return () => times[Math.min(index++, times.length - 1)];
  }

  it("段ごとに、始めてから終わるまでの時間を記録した順に返す", async () => {
    // 測り始め 0 → auth 0〜5 → watched 5〜35
    const timer = startStageTimer(clock([0, 0, 5, 5, 35]));
    expect(await timer.time("auth", async () => "login")).toBe("login");
    await timer.time("watched", async () => null);
    expect(timer.stages()).toEqual([
      { name: "auth", ms: 5 },
      { name: "watched", ms: 30 },
    ]);
  });

  it("投げた段も記録して、そのまま投げる", async () => {
    const timer = startStageTimer(clock([0, 10, 25]));
    await expect(
      timer.time("repos", async () => {
        throw new Error("failed");
      }),
    ).rejects.toThrow("failed");
    expect(timer.stages()).toEqual([{ name: "repos", ms: 15 }]);
  });

  it("add は、渡した時間をそのまま記録する", () => {
    const timer = startStageTimer(clock([0]));
    timer.add("First-Repo", 12.34);
    expect(timer.stages()).toEqual([{ name: "first-repo", ms: 12.3 }]);
  });

  it("mark は、測り始めてからの時間を記録する", () => {
    const timer = startStageTimer(clock([100, 180]));
    timer.mark("total");
    expect(timer.stages()).toEqual([{ name: "total", ms: 80 }]);
  });
});

describe("サーバーが立ち上がってからの時間", () => {
  it("読み込んだ時刻からの ms。時計が戻っても負にしない", () => {
    expect(instanceAgeMs(Date.now() + 5000)).toBeGreaterThanOrEqual(5000);
    expect(instanceAgeMs(0)).toBe(0);
  });
});
