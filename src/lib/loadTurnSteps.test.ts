import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RepoResult } from "./github/types";
import type { TurnsSoFar } from "./loadTurnSteps";

const mocks = vi.hoisted(() => ({
  getRepoResult: vi.fn(),
  getStaleRepoResult: vi.fn(),
  loadTurns: vi.fn(),
  loadWatchedRepos: vi.fn(),
}));

vi.mock("./auth", () => ({ getGitHubToken: async () => "token" }));
vi.mock("./github/fetch", () => ({
  getRepoResult: mocks.getRepoResult,
  getStaleRepoResult: mocks.getStaleRepoResult,
}));
vi.mock("./github/rateHistoryStore", () => ({ syncRateHistory: async () => undefined }));
vi.mock("./loadTurns", () => ({ loadTurns: mocks.loadTurns }));
vi.mock("./watchedRepos", () => ({ loadWatchedRepos: mocks.loadWatchedRepos }));

import { loadTurnSteps } from "./loadTurnSteps";

const result = (repo: string): RepoResult =>
  ({
    owner: "o",
    repo,
    ok: true,
    data: { issues: [], pulls: [], comments: [], pullChecks: {}, events: [] },
  }) as unknown as RepoResult;

/** 最後まで段を読んで、出た段の数を返す */
async function drain(build: (turns: TurnsSoFar) => object) {
  let step = await loadTurnSteps(build);
  let count = 1;
  while (step.next !== null) {
    step = await step.next;
    count += 1;
  }
  return count;
}

describe("loadTurnSteps の組み立て（build）の回数", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const repos = [{ owner: "o", repo: "a" }];
    mocks.loadWatchedRepos.mockResolvedValue({ repos });
    mocks.loadTurns.mockResolvedValue({ results: [result("a")], items: [], addedNotices: [], now: new Date() });
    mocks.getStaleRepoResult.mockResolvedValue(null);
  });

  it("最初の段で新しい結果がそろっていれば、1回だけ組み立てる", async () => {
    mocks.getRepoResult.mockResolvedValue(result("a"));
    const build = vi.fn((turns: TurnsSoFar) => ({ complete: turns.complete }));
    expect(await drain(build)).toBe(1);
    expect(build).toHaveBeenCalledTimes(1);
    expect(build.mock.calls[0]?.[0].complete).toBe(true);
  });

  it("そろっていなければ、多くて2回（最初の段と仕上げ）で、間の段は飛ばす", async () => {
    mocks.getRepoResult.mockImplementation(
      () => new Promise<RepoResult>((resolve) => setTimeout(() => resolve(result("a")), 600)),
    );
    mocks.getStaleRepoResult.mockResolvedValue(result("a"));
    const build = vi.fn((turns: TurnsSoFar) => ({ complete: turns.complete }));
    await drain(build);
    expect(build.mock.calls.length).toBeLessThanOrEqual(2);
    expect(build.mock.calls.at(-1)?.[0]?.complete).toBe(true);
  });

  it("仕上げ（loadTurns）が投げたときは、そろった分で1回組み立てる", async () => {
    mocks.getRepoResult.mockResolvedValue(result("a"));
    mocks.loadTurns.mockRejectedValue(new Error("失敗"));
    const build = vi.fn((turns: TurnsSoFar) => ({ complete: turns.complete }));
    expect(await drain(build)).toBe(1);
    expect(build).toHaveBeenCalledTimes(1);
    expect(build.mock.calls[0]?.[0].complete).toBe(false);
  });
});
