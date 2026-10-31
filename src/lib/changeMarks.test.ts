import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CHANGES_POLL_INTERVAL_MS,
  isBehindChangeMarks,
  parseChangeMarks,
  repoChangeKey,
  startChangeWatch,
  type ChangeMarks,
  type ChangeMarksResult,
  type ChangesVisibilitySource,
} from "./changeMarks";

const T1 = "2026-01-01T00:00:00.000Z";
const T2 = "2026-01-01T00:00:15.000Z";

describe("isBehindChangeMarks", () => {
  it("印が反映済みより新しいリポジトリがあれば取り直す", () => {
    expect(isBehindChangeMarks({ "o/a": T1, "o/b": T1 }, { "o/a": T1, "o/b": T1 })).toBe(false);
    expect(isBehindChangeMarks({ "o/a": T1, "o/b": T1 }, { "o/a": T1, "o/b": T2 })).toBe(true);
  });

  it("反映済みの方が新しい（印が遅れて届いた）ときは取り直さない", () => {
    expect(isBehindChangeMarks({ "o/a": T2 }, { "o/a": T1 })).toBe(false);
  });

  it("反映済みの印が無い・読めないリポジトリは比べない", () => {
    expect(isBehindChangeMarks({}, { "o/a": T2 })).toBe(false);
    expect(isBehindChangeMarks({ "o/a": "x" }, { "o/a": T2 })).toBe(false);
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

  it("5秒ごとに見て、反映済みより新しい印のときだけ取り直す。反映されたらやめる", async () => {
    const marks: ChangeMarksResult[] = [{ "o/r": T1 }, { "o/r": T1 }, { "o/r": T2 }];
    const load = vi.fn(async () => marks.shift() ?? { "o/r": T2 });
    let applied: ChangeMarks = { "o/r": T1 };
    const refresh = vi.fn();
    const source = new FakeDocument();
    const stop = startChangeWatch({ load, getApplied: () => applied, refresh, onUnavailable: vi.fn(), source });

    await vi.advanceTimersByTimeAsync(0);
    expect(load).toHaveBeenCalledTimes(1);
    expect(refresh).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(CHANGES_POLL_INTERVAL_MS);
    expect(load).toHaveBeenCalledTimes(2);
    expect(refresh).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(CHANGES_POLL_INTERVAL_MS);
    expect(refresh).toHaveBeenCalledTimes(1);

    // まだ反映されていない（取り直しが前のデータを返した）なら、次もまた取り直す
    await vi.advanceTimersByTimeAsync(CHANGES_POLL_INTERVAL_MS);
    expect(refresh).toHaveBeenCalledTimes(2);

    applied = { "o/r": T2 };
    await vi.advanceTimersByTimeAsync(CHANGES_POLL_INTERVAL_MS);
    expect(refresh).toHaveBeenCalledTimes(2);
    stop();
  });

  it("見張りを作り直しても（20秒⇔30秒）、その間に来た変化を取りこぼさない", async () => {
    let serverMark = T1;
    const load = vi.fn(async (): Promise<ChangeMarksResult> => ({ "o/r": serverMark }));
    const applied: ChangeMarks = { "o/r": T1 };
    const refresh = vi.fn();
    const source = new FakeDocument();
    const options = { load, getApplied: () => applied, refresh, onUnavailable: vi.fn(), source };

    const stopFirst = startChangeWatch(options);
    await vi.advanceTimersByTimeAsync(0);
    expect(refresh).not.toHaveBeenCalled();

    // 作り直しの間に変化が来た
    stopFirst();
    serverMark = T2;
    const stopSecond = startChangeWatch(options);
    await vi.advanceTimersByTimeAsync(0);
    expect(refresh).toHaveBeenCalledTimes(1);
    stopSecond();
  });

  it("非表示の間は見ず、戻ったらすぐ見る", async () => {
    const load = vi.fn(async (): Promise<ChangeMarksResult> => ({ "o/r": T1 }));
    const source = new FakeDocument();
    const stop = startChangeWatch({
      load,
      getApplied: () => ({}),
      refresh: vi.fn(),
      onUnavailable: vi.fn(),
      source,
    });
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
    startChangeWatch({ load, getApplied: () => ({}), refresh: vi.fn(), onUnavailable, source });
    await vi.advanceTimersByTimeAsync(CHANGES_POLL_INTERVAL_MS * 3);
    expect(onUnavailable).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledTimes(1);
    expect(source.listenerCount).toBe(0);
  });

  it("失敗（null・例外）のときは何もせず、次に見る", async () => {
    const results: (ChangeMarksResult | Error)[] = [{ "o/r": T1 }, null, new Error("x"), { "o/r": T1 }];
    const load = vi.fn(async () => {
      const next = results.shift() ?? { "o/r": T1 };
      if (next instanceof Error) throw next;
      return next;
    });
    const refresh = vi.fn();
    const stop = startChangeWatch({
      load,
      getApplied: () => ({ "o/r": T1 }),
      refresh,
      onUnavailable: vi.fn(),
      source: new FakeDocument(),
    });
    await vi.advanceTimersByTimeAsync(CHANGES_POLL_INTERVAL_MS * 3);
    expect(load).toHaveBeenCalledTimes(4);
    expect(refresh).not.toHaveBeenCalled();
    stop();
  });
});
