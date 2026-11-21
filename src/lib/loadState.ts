import type { RepoResult } from "./github/types";
import { loadErrorsOf, type LoadError } from "./loadErrors";
import { oldestReadAt } from "./staleSnapshot";
import { findUnreadableWork } from "./unreadableWork";

// 読めなかったリポジトリがあるときに、何を出し、何を言ってよいかの判定（docs/spec.md の「全部のリポジトリを待つページ」の
// 「取り直しが失敗で終わったリポジトリ」、「読めなかったリポジトリは、空ではなく読めなかったと出す」、「更新」）。

/** リポジトリ1つの取得：新しい結果（まだ届いていなければ null）と、覚えている最後の結果（無ければ・まだ読んでいなければ null） */
export type RepoLoad = { fresh: RepoResult | null; stale: RepoResult | null };

/** 出している中身の出どころ：新しい結果／覚えている結果／無し（まだ届いていない、または読めず覚えている物も無い） */
export type ShownFrom = "fresh" | "stale" | "none";

/** 同期の状態：全部読めた／一部読めなかった／全部読めなかった（まだ届いていない所は数えない） */
export type SyncReadState = "ok" | "partial" | "failed";

export type LoadState = {
  /** リポジトリごとに出す結果。読めず覚えている物も無いときは、失敗の結果（中身は無く、「読めなかった」の行になる）。まだなら null */
  shown: (RepoResult | null)[];
  /** リポジトリごとの、出している中身の出どころ */
  from: ShownFrom[];
  /** 覚えている結果を出しているリポジトリ（`owner/repo`） */
  staleRepos: string[];
  /** 覚えている結果を出しているときの、その内容の時刻（出している覚えている結果のうち、いちばん古い読んだ時刻。ISO）。無ければ null */
  staleAt: string | null;
  /** 覚えている結果を出している理由：新しい結果を待っている／読めなかった。出していなければ null */
  staleBecause: "loading" | "unreadable" | null;
  /** 読めなかったリポジトリと理由（覚えている結果を出していても入る） */
  errors: LoadError[];
  /** まだ届いていないリポジトリの数（新しい結果も、出せる覚えている結果も、読めなかったという結果も無い所） */
  pendingRepos: number;
  /** 「何も無い」と言ってよいか（読めなかった・まだ届いていないリポジトリが1つでもあれば言わない） */
  canSayEmpty: boolean;
  sync: SyncReadState;
};

/** 出している結果が中身を持つか（失敗の結果・まだの所は持たない） */
function okData(result: RepoResult | null): { data: Extract<RepoResult, { ok: true }>["data"]; changeMark?: string } | null {
  return result?.ok ? { data: result.data, changeMark: result.changeMark } : null;
}

/**
 * リポジトリごとの新しい結果と覚えている結果から、出す中身・言ってよいこと・同期の状態を決める。
 * - 新しい結果が読めた所は、それを出す（覚えている結果は使わない）
 * - 新しい結果が失敗した所は、覚えている結果（中身のある物）があればそれを、無ければ失敗の結果を出す
 * - 新しい結果がまだの所は、覚えている結果があればそれを、無ければ無し
 */
export function resolveLoadState(loads: RepoLoad[], now: Date = new Date()): LoadState {
  const shown: (RepoResult | null)[] = [];
  const from: ShownFrom[] = [];
  let unreadableStale = false;
  for (const { fresh, stale } of loads) {
    const usableStale = stale?.ok ? stale : null;
    if (fresh?.ok) {
      shown.push(fresh);
      from.push("fresh");
    } else if (usableStale) {
      shown.push(usableStale);
      from.push("stale");
      if (fresh) unreadableStale = true;
    } else {
      shown.push(fresh);
      from.push("none");
    }
  }
  const pendingRepos = shown.filter((result) => result === null).length;
  const staleShown = shown.filter((_, index) => from[index] === "stale");
  const failed = loads.flatMap(({ fresh }) => (fresh && !fresh.ok ? [fresh] : []));
  const arrived = loads.filter(({ fresh }) => fresh !== null).length;
  const sync: SyncReadState =
    failed.length === 0 ? "ok" : failed.length === arrived && arrived === loads.length ? "failed" : "partial";
  // 読めたが、どの区画にも出せない作業は、黙って落とさず `状態が読めない` の行にする
  const unreadableWork: LoadError[] = shown.flatMap((result) =>
    result?.ok
      ? findUnreadableWork(result.owner, result.repo, result.data, now).map(({ repo, message }) => ({
          repo,
          message,
          work: true as const,
        }))
      : [],
  );
  return {
    shown,
    from,
    staleRepos: staleShown.flatMap((result) => (result ? [`${result.owner}/${result.repo}`] : [])),
    staleAt: oldestReadAt(staleShown.flatMap((result) => okData(result) ?? [])),
    staleBecause: staleShown.length === 0 ? null : unreadableStale ? "unreadable" : "loading",
    errors: [...loadErrorsOf(failed), ...unreadableWork],
    pendingRepos,
    canSayEmpty: failed.length === 0 && unreadableWork.length === 0 && pendingRepos === 0,
    sync,
  };
}
