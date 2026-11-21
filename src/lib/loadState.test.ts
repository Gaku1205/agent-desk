import { describe, expect, it } from "vitest";
import type { RepoData, RepoResult } from "./github/types";
import { resolveLoadState } from "./loadState";

function data(readAt: string): RepoData {
  return {
    issues: [],
    pulls: [],
    comments: [],
    pullChecks: {},
    events: [],
    sync: { mode: "full", readAt, fullAt: readAt, count: 0 },
  };
}

const ok = (repo: string, readAt: string): RepoResult => ({ owner: "acme", repo, ok: true, data: data(readAt) });
const failed = (repo: string, message = "GitHubからデータを取れませんでした"): RepoResult => ({
  owner: "acme",
  repo,
  ok: false,
  error: { kind: "other", message },
});
const rateLimited = (repo: string): RepoResult => ({
  owner: "acme",
  repo,
  ok: false,
  error: { kind: "rate_limited", message: "GitHubのレート制限に達しました。01:14（日本時間）ごろに回復します" },
});

const NEW = "2026-11-19T07:00:00Z";
const OLD = "2026-11-19T06:00:00Z";
const OLDER = "2026-11-19T05:30:00Z";

describe("読めなかったリポジトリがあるときに出す物", () => {
  it("全部読めた：新しい結果を出し、空と言ってよく、同期は全部読めた（今までどおり）", () => {
    const fresh = [ok("a", NEW), ok("b", NEW)];
    const state = resolveLoadState(fresh.map((result) => ({ fresh: result, stale: ok(result.repo, OLD) })));
    expect(state.shown).toEqual(fresh);
    expect(state.from).toEqual(["fresh", "fresh"]);
    expect(state.staleRepos).toEqual([]);
    expect(state.staleAt).toBeNull();
    expect(state.staleBecause).toBeNull();
    expect(state.errors).toEqual([]);
    expect(state.canSayEmpty).toBe(true);
    expect(state.sync).toBe("ok");
  });

  it("5つのうち2つだけ（覚えている結果で）届いた段：空と言ってはいけない", () => {
    const loads = [
      { fresh: null, stale: ok("a", OLD) },
      { fresh: null, stale: ok("b", OLD) },
      { fresh: null, stale: null },
      { fresh: null, stale: null },
      { fresh: null, stale: null },
    ];
    const state = resolveLoadState(loads);
    expect(state.pendingRepos).toBe(3);
    expect(state.canSayEmpty).toBe(false);
    // 全部そろったら言ってよい
    const done = resolveLoadState(loads.map((load, index) => ({ ...load, fresh: ok(`r${index}`, NEW) })));
    expect(done.pendingRepos).toBe(0);
    expect(done.canSayEmpty).toBe(true);
  });

  it("新しい結果が失敗・覚えている結果あり：覚えている結果を出し、読めなかった行も残す", () => {
    const stale = ok("a", OLD);
    const state = resolveLoadState([{ fresh: failed("a"), stale }]);
    expect(state.shown).toEqual([stale]);
    expect(state.from).toEqual(["stale"]);
    expect(state.staleRepos).toEqual(["acme/a"]);
    expect(state.staleAt).toBe(OLD);
    expect(state.staleBecause).toBe("unreadable");
    expect(state.errors).toEqual([{ repo: "acme/a", message: "GitHubからデータを取れませんでした" }]);
    expect(state.canSayEmpty).toBe(false);
    expect(state.sync).toBe("failed");
  });

  it("新しい結果が失敗・覚えている結果なし：失敗の結果（読めなかった行）だけ", () => {
    const fresh = failed("a");
    const state = resolveLoadState([{ fresh, stale: null }]);
    expect(state.shown).toEqual([fresh]);
    expect(state.from).toEqual(["none"]);
    expect(state.staleAt).toBeNull();
    expect(state.staleBecause).toBeNull();
    expect(state.errors).toHaveLength(1);
    expect(state.canSayEmpty).toBe(false);
    expect(state.sync).toBe("failed");
  });

  it("新しい結果が成功・覚えている結果なし：新しい結果", () => {
    const fresh = ok("a", NEW);
    const state = resolveLoadState([{ fresh, stale: null }]);
    expect(state.shown).toEqual([fresh]);
    expect(state.from).toEqual(["fresh"]);
    expect(state.sync).toBe("ok");
  });

  it("新しい結果がまだ：覚えている結果を「読んでいる」理由で出す。無ければ無し", () => {
    const stale = ok("a", OLD);
    const state = resolveLoadState([
      { fresh: null, stale },
      { fresh: null, stale: null },
    ]);
    expect(state.shown).toEqual([stale, null]);
    expect(state.from).toEqual(["stale", "none"]);
    expect(state.staleBecause).toBe("loading");
    // まだ届いていない所があるので、空とは言わない（#754）
    expect(state.pendingRepos).toBe(1);
    expect(state.canSayEmpty).toBe(false);
    expect(state.sync).toBe("ok");
  });

  it("覚えている結果が失敗の物なら使わない", () => {
    const fresh = failed("a");
    const state = resolveLoadState([{ fresh, stale: failed("a") }]);
    expect(state.from).toEqual(["none"]);
    expect(state.shown).toEqual([fresh]);
  });

  it("一部だけ失敗：読めた所は新しい結果、読めなかった所は覚えている結果。同期は一部読めなかった", () => {
    const state = resolveLoadState([
      { fresh: ok("a", NEW), stale: ok("a", OLDER) },
      { fresh: failed("b"), stale: ok("b", OLD) },
      { fresh: failed("c"), stale: null },
    ]);
    expect(state.from).toEqual(["fresh", "stale", "none"]);
    expect(state.staleRepos).toEqual(["acme/b"]);
    // 時刻は、出している覚えている結果のうちいちばん古い物（新しい結果の a の古い結果は数えない）
    expect(state.staleAt).toBe(OLD);
    expect(state.errors.map((error) => error.repo)).toEqual(["acme/b", "acme/c"]);
    expect(state.canSayEmpty).toBe(false);
    expect(state.sync).toBe("partial");
  });

  it("全部失敗：同期は全部読めなかった。覚えている結果のうちいちばん古い時刻", () => {
    const state = resolveLoadState([
      { fresh: failed("a"), stale: ok("a", OLD) },
      { fresh: failed("b"), stale: ok("b", OLDER) },
    ]);
    expect(state.from).toEqual(["stale", "stale"]);
    expect(state.staleAt).toBe(OLDER);
    expect(state.sync).toBe("failed");
  });

  it("まだ届いていない所があれば、届いた分が全部失敗でも「全部読めなかった」にはしない", () => {
    const state = resolveLoadState([
      { fresh: failed("a"), stale: null },
      { fresh: null, stale: null },
    ]);
    expect(state.sync).toBe("partial");
    expect(state.canSayEmpty).toBe(false);
  });

  it("回数制限：同じ扱いで、回復時刻の文はそのまま", () => {
    const stale = ok("a", OLD);
    const state = resolveLoadState([{ fresh: rateLimited("a"), stale }]);
    expect(state.shown).toEqual([stale]);
    expect(state.errors).toEqual([
      { repo: "acme/a", message: "GitHubのレート制限に達しました。01:14（日本時間）ごろに回復します" },
    ]);
    expect(state.sync).toBe("failed");
  });

  it("リポジトリが無ければ、全部読めた扱い", () => {
    const state = resolveLoadState([]);
    expect(state.sync).toBe("ok");
    expect(state.canSayEmpty).toBe(true);
  });
});
