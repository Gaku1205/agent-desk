import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CHANGE_REFRESH_MIN_INTERVAL_MS,
  CHANGE_REFRESH_WAIT_MS,
  CHANGES_POLL_BUSY_INTERVAL_MS,
  CHANGES_POLL_INTERVAL_MS,
  changesPollIntervalMs,
  hasUrgentChange,
  isBehindChangeMarks,
  mayRefreshForChange,
  mergeUrgentMarks,
  parseChangeMarks,
  repoChangeKey,
  shouldRequestRefresh,
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

describe("changesPollIntervalMs", () => {
  it("動いている物があるときも、無いときも15秒", () => {
    expect(changesPollIntervalMs(true)).toBe(15_000);
    expect(changesPollIntervalMs(false)).toBe(15_000);
    expect(CHANGES_POLL_BUSY_INTERVAL_MS).toBe(15_000);
    expect(CHANGES_POLL_INTERVAL_MS).toBe(15_000);
  });
});

describe("隠れているタブ", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("最初から隠れていれば聞かず、見えるようになったら1回だけ聞く", async () => {
    const load = vi.fn(async (): Promise<ChangeMarksResult> => ({ "o/r": T1 }));
    const source = new FakeDocument();
    source.hidden = true;
    const stop = startChangeWatch({ load, getApplied: () => ({}), refresh: vi.fn(), onUnavailable: vi.fn(), source });
    await vi.advanceTimersByTimeAsync(CHANGES_POLL_INTERVAL_MS * 4);
    expect(load).not.toHaveBeenCalled();
    source.setHidden(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(load).toHaveBeenCalledTimes(1);
    stop();
  });

  it("返事を待つ間に隠れたら、作り直さない", async () => {
    const source = new FakeDocument();
    const refresh = vi.fn();
    const load = vi.fn(async (): Promise<ChangeMarksResult> => {
      source.setHidden(true);
      return { "o/r": T2 };
    });
    const stop = startChangeWatch({
      load,
      getApplied: () => ({ "o/r": T1 }),
      refresh,
      onUnavailable: vi.fn(),
      source,
    });
    await vi.advanceTimersByTimeAsync(CHANGES_POLL_INTERVAL_MS * 3);
    expect(refresh).not.toHaveBeenCalled();
    stop();
  });
});

describe("急ぎの印・作り直しの間隔", () => {
  it("反映済みより新しい印で、急ぎの時刻も反映済みより新しいときだけ急ぎ", () => {
    const applied = { "o/r": T1 };
    expect(hasUrgentChange(applied, mergeUrgentMarks({ "o/r": T2 }, { "o/r": T2 }))).toBe(true);
    expect(hasUrgentChange(applied, mergeUrgentMarks({ "o/r": T2 }, { "o/r": T1 }))).toBe(false);
    expect(hasUrgentChange(applied, mergeUrgentMarks({ "o/r": T1 }, { "o/r": T2 }))).toBe(false);
    expect(hasUrgentChange(applied, { "o/r": T2 })).toBe(false);
  });

  it("急ぎの印は、取り直すかどうかの判定には混ざらない", () => {
    expect(isBehindChangeMarks({ "o/r": T2 }, mergeUrgentMarks({ "o/r": T1 }, { "o/r": T2 }))).toBe(false);
  });

  it("変化による作り直しは、60秒に1回まで。急ぎは除く", () => {
    expect(mayRefreshForChange({ lastAt: null, now: 1_000, urgent: false })).toBe(true);
    expect(mayRefreshForChange({ lastAt: 1_000, now: 30_000, urgent: false })).toBe(false);
    expect(mayRefreshForChange({ lastAt: 1_000, now: 30_000, urgent: true })).toBe(true);
    expect(mayRefreshForChange({ lastAt: 1_000, now: 1_000 + CHANGE_REFRESH_MIN_INTERVAL_MS, urgent: false })).toBe(
      true,
    );
  });

  it("見張りは急ぎかどうかを渡して取り直しを頼む", async () => {
    vi.useFakeTimers();
    const refresh = vi.fn();
    const stop = startChangeWatch({
      load: async () => mergeUrgentMarks({ "o/r": T2 }, { "o/r": T2 }),
      getApplied: () => ({ "o/r": T1 }),
      refresh,
      onUnavailable: vi.fn(),
      source: new FakeDocument(),
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(refresh).toHaveBeenCalledWith(true);
    stop();
    vi.useRealTimers();
  });
});

describe("shouldRequestRefresh", () => {
  it("頼んでいなければ頼む。頼んだ結果を待っている間（10秒以内）は重ねて頼まない", () => {
    expect(shouldRequestRefresh({ requestedAt: null, now: 1000 })).toBe(true);
    expect(shouldRequestRefresh({ requestedAt: 1000, now: 3500 })).toBe(false);
    expect(shouldRequestRefresh({ requestedAt: 1000, now: 1000 + CHANGE_REFRESH_WAIT_MS - 1 })).toBe(false);
  });

  it("10秒たっても届かなければ、もう一度頼む。時計が戻ったときも頼む", () => {
    expect(shouldRequestRefresh({ requestedAt: 1000, now: 1000 + CHANGE_REFRESH_WAIT_MS })).toBe(true);
    expect(shouldRequestRefresh({ requestedAt: 5000, now: 1000 })).toBe(true);
  });
});
