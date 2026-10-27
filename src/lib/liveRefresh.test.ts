import { describe, expect, it, vi } from "vitest";
import {
  formatSseEvent,
  getLiveWatchedRepos,
  publishLiveRefresh,
  rememberWatchedRepos,
  subscribeLiveRefresh,
} from "./liveRefresh";

describe("subscribeLiveRefresh / publishLiveRefresh", () => {
  it("つながっている全部に伝え、外したら伝えない", () => {
    const a = vi.fn();
    const b = vi.fn();
    const offA = subscribeLiveRefresh(a);
    const offB = subscribeLiveRefresh(b);

    expect(publishLiveRefresh("o/r")).toBe(2);
    expect(a).toHaveBeenCalledWith("o/r");
    expect(b).toHaveBeenCalledWith("o/r");

    offA();
    expect(publishLiveRefresh("o/r")).toBe(1);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(2);
    offB();
    expect(publishLiveRefresh("o/r")).toBe(0);
  });

  it("1つが失敗しても、ほかには伝える", () => {
    const ok = vi.fn();
    const offBad = subscribeLiveRefresh(() => {
      throw new Error("closed");
    });
    const offOk = subscribeLiveRefresh(ok);

    publishLiveRefresh("o/r");
    expect(ok).toHaveBeenCalledTimes(1);
    offBad();
    offOk();
  });
});

describe("getLiveWatchedRepos", () => {
  it("覚えた監視するリポジトリを返す", () => {
    rememberWatchedRepos([{ owner: "o", repo: "r" }]);
    expect(getLiveWatchedRepos()).toEqual([{ owner: "o", repo: "r" }]);
  });
});

describe("formatSseEvent", () => {
  it("event と data の行に、空行を付ける", () => {
    expect(formatSseEvent("refresh", "o/r")).toBe("event: refresh\ndata: o/r\n\n");
  });

  it("data の改行は空白にする（1通が割れないように）", () => {
    expect(formatSseEvent("refresh", "a\nb\r\nc")).toBe("event: refresh\ndata: a b c\n\n");
  });
});
