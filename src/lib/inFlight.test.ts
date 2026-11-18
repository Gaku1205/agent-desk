import { describe, expect, it } from "vitest";
import { shareInFlight } from "./inFlight";

describe("shareInFlight", () => {
  it("同じキーを同時に頼まれたら、処理は1回だけ動き、全員が同じ結果を受け取る", async () => {
    const inFlight = new Map<string, Promise<string>>();
    let calls = 0;
    let finish: (value: string) => void = () => undefined;
    const run = () =>
      new Promise<string>((resolve) => {
        calls += 1;
        finish = resolve;
      });
    const first = shareInFlight(inFlight, "a", run);
    const second = shareInFlight(inFlight, "a", run);
    finish("done");
    expect(await Promise.all([first, second])).toEqual(["done", "done"]);
    expect(calls).toBe(1);
  });

  it("終わったら取り除く（結果は覚えず、次に頼まれたらまた動かす）", async () => {
    const inFlight = new Map<string, Promise<number>>();
    let calls = 0;
    const run = async () => ++calls;
    expect(await shareInFlight(inFlight, "a", run)).toBe(1);
    expect(inFlight.size).toBe(0);
    expect(await shareInFlight(inFlight, "a", run)).toBe(2);
  });

  it("キーが違えば別々に動く", async () => {
    const inFlight = new Map<string, Promise<string>>();
    const seen: string[] = [];
    const run = (name: string) => async () => {
      seen.push(name);
      return name;
    };
    expect(await Promise.all([shareInFlight(inFlight, "a", run("a")), shareInFlight(inFlight, "b", run("b"))])).toEqual(["a", "b"]);
    expect(seen).toEqual(["a", "b"]);
  });

  it("失敗は待っていた全員に伝わり、そのあとは取り除かれてやり直せる", async () => {
    const inFlight = new Map<string, Promise<string>>();
    let calls = 0;
    const run = async () => {
      calls += 1;
      if (calls === 1) throw new Error("失敗");
      return "ok";
    };
    const first = shareInFlight(inFlight, "a", run);
    const second = shareInFlight(inFlight, "a", run);
    await expect(first).rejects.toThrow("失敗");
    await expect(second).rejects.toThrow("失敗");
    expect(inFlight.size).toBe(0);
    expect(await shareInFlight(inFlight, "a", run)).toBe("ok");
  });
});
