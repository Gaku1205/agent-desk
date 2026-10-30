import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CHANGES_POLL_INTERVAL_MS,
  hasChangedRepo,
  parseChangeMarks,
  repoChangeKey,
  startChangeWatch,
  type ChangeMarksResult,
  type ChangesVisibilitySource,
} from "./changeMarks";

describe("hasChangedRepo", () => {
  it("初めて見たときは変わっていない扱い", () => {
    expect(hasChangedRepo(null, { "o/r": "t1" })).toBe(false);
  });

  it("どれかの時刻が違えば変わった", () => {
    expect(hasChangedRepo({ "o/a": "t1", "o/b": "t1" }, { "o/a": "t1", "o/b": "t1" })).toBe(false);
    expect(hasChangedRepo({ "o/a": "t1", "o/b": "t1" }, { "o/a": "t1", "o/b": "t2" })).toBe(true);
  });

  it("片方にしか無いリポジトリも変わった扱い", () => {
    expect(hasChangedRepo({ "o/a": "t1" }, { "o/a": "t1", "o/b": "t1" })).toBe(true);
    expect(hasChangedRepo({ "o/a": "t1", "o/b": "t1" }, { "o/a": "t1" })).toBe(true);
  });
});

describe("parseChangeMarks", () => {
  it("changes の形を確かめる", () => {
    expect(parseChangeMarks({ changes: { "o/r": "t" } })).toEqual({ "o/r": "t" });
    expect(parseChangeMarks({ changes: { "o/r": 1 } })).toBeNull();
    expect(parseChangeMarks({ changes: [] })).toBeNull();
    expect(parseChangeMarks(null)).toBeNull();
  });
});

describe("repoChangeKey", () => {
  it("owner/repo を小文字で", () => {
    expect(repoChangeKey({ owner: "O", repo: "R" })).toBe("o/r");
  });
});

class FakeDocument implements ChangesVisibilitySource {
  hidden = false;
  private listeners = new Set<() => void>();
  addEventListener(_type: "visibilitychange", listener: () => void) {
    this.listeners.add(listener);
  }
  removeEventListener(_type: "visibilitychange", listener: () => void) {
    this.listeners.delete(listener);
  }
  setHidden(hidden: boolean) {
    this.hidden = hidden;
    for (const listener of this.listeners) listener();
  }
  get listenerCount() {
    return this.listeners.size;
  }
}

describe("startChangeWatch", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("5秒ごとに見て、変わったときだけ取り直す", async () => {
    const marks: ChangeMarksResult[] = [{ "o/r": "t1" }, { "o/r": "t1" }, { "o/r": "t2" }];
    const load = vi.fn(async () => marks.shift() ?? { "o/r": "t2" });
    const refresh = vi.fn();
    const source = new FakeDocument();
    const stop = startChangeWatch({ load, refresh, onUnavailable: vi.fn(), source });

    await vi.advanceTimersByTimeAsync(0);
    expect(load).toHaveBeenCalledTimes(1);
    expect(refresh).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(CHANGES_POLL_INTERVAL_MS);
    expect(load).toHaveBeenCalledTimes(2);
    expect(refresh).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(CHANGES_POLL_INTERVAL_MS);
    expect(refresh).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(CHANGES_POLL_INTERVAL_MS);
    expect(refresh).toHaveBeenCalledTimes(1);
    stop();
  });

  it("非表示の間は見ず、戻ったらすぐ見る", async () => {
    const load = vi.fn(async (): Promise<ChangeMarksResult> => ({ "o/r": "t1" }));
    const source = new FakeDocument();
    const stop = startChangeWatch({ load, refresh: vi.fn(), onUnavailable: vi.fn(), source });
    await vi.advanceTimersByTimeAsync(0);
    source.setHidden(true);
    await vi.advanceTimersByTimeAsync(CHANGES_POLL_INTERVAL_MS * 3);
    expect(load).toHaveBeenCalledTimes(1);
    source.setHidden(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(load).toHaveBeenCalledTimes(2);
    stop();
    expect(source.listenerCount).toBe(0);
  });

  it("404（unavailable）なら見るのをやめて知らせる", async () => {
    const load = vi.fn(async (): Promise<ChangeMarksResult> => "unavailable");
    const onUnavailable = vi.fn();
    const source = new FakeDocument();
    startChangeWatch({ load, refresh: vi.fn(), onUnavailable, source });
    await vi.advanceTimersByTimeAsync(CHANGES_POLL_INTERVAL_MS * 3);
    expect(onUnavailable).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledTimes(1);
    expect(source.listenerCount).toBe(0);
  });

  it("失敗（null・例外）のときは何もせず、次に見る", async () => {
    const results: (ChangeMarksResult | Error)[] = [{ "o/r": "t1" }, null, new Error("x"), { "o/r": "t1" }];
    const load = vi.fn(async () => {
      const next = results.shift() ?? { "o/r": "t1" };
      if (next instanceof Error) throw next;
      return next;
    });
    const refresh = vi.fn();
    const stop = startChangeWatch({ load, refresh, onUnavailable: vi.fn(), source: new FakeDocument() });
    await vi.advanceTimersByTimeAsync(CHANGES_POLL_INTERVAL_MS * 3);
    expect(load).toHaveBeenCalledTimes(4);
    expect(refresh).not.toHaveBeenCalled();
    stop();
  });
});
