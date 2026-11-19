"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { AddedNotice } from "@/lib/autoAdd";
import {
  applyRepoCount,
  fullNavCounts,
  NO_NAV_COUNTS,
  withPageCounts,
  type NavCounts,
  type RepoCountFeed,
} from "@/lib/navCounts";
import { parseSavedRepos, reposToShow, WATCHED_REPOS_CHANNEL, type SavedRepos } from "@/lib/savedRepos";
import type { DriftSummary } from "@/lib/selfCheck";
import type { TurnCounts } from "@/lib/turn";
import type { NewIssueRepo } from "./NewIssueForm";
import type { DeskNav } from "./Desk";

/** 全リポジトリを読み終えてから届く物（layout が Suspense で後から流す） */
export type StreamedNav = {
  counts: TurnCounts;
  runningCounts: TurnCounts;
  newIssueRepos: NewIssueRepo[];
  /** 枠を使っている作業の数（Slots & Queue の「使用中」と同じ数え方）。「同時に動かす」の `1 / 1` に使う */
  slotsInUse: number | null;
  /** 読めなかったリポジトリ（`owner/repo` の小文字）。札は残し、数は「–」にする */
  unreadableRepos: string[];
  addedNotices: AddedNotice[];
  /** 開いている表示のずれの Issue の数と、いちばん新しい1件の URL（上のバーの「表示のずれ N」） */
  drift: DriftSummary;
  /** この結果を作った描画の時刻（ISO文字列）。リポジトリごとの件数（`RepoCountFeed`）と比べる */
  renderedAt: string;
};

type NavState = {
  /** 左のバー用の、件数以外の情報（すぐ分かる） */
  base: DeskNav;
  /** 全リポジトリを読み終えたら入る。それまでは null */
  streamed: StreamedNav | null;
  /** 読み終えたリポジトリから順に入る件数（全部を読み終えたら、その結果で入れ替わる） */
  live: NavCounts;
  /** 設定で保存した監視リポジトリ（保存のあとの取り直しが届くまで、札に使う） */
  saved: SavedRepos<DeskNav["repos"]> | null;
  setStreamed: (value: StreamedNav) => void;
  setRepoCount: (feed: RepoCountFeed) => void;
  /** ページが全部を読み終えて数えた件数で入れ替える（ページを移っても件数が古いまま残らないように） */
  setPageCounts: (page: Parameters<typeof withPageCounts>[1]) => void;
  applySavedRepos: (names: unknown) => void;
};

const NavContext = createContext<NavState | null>(null);

/**
 * 左のバー用の情報（リポジトリ・件数・ユーザー）を、layout から上端の帯・読み込み中の骨組み・リポジトリのページへ渡す。
 * 件数は、読み終えたリポジトリから順に入る（`RepoFeed` が `setRepoCount` で入れる）。
 * Issueを書く欄の一覧など、全部を読み終えてから決まる物は後から入る（`LayoutFeed` が `setStreamed` で入れる）
 */
export function NavProvider({ base, children }: { base: DeskNav; children: ReactNode }) {
  const [state, setState] = useState<{ streamed: StreamedNav | null; live: NavCounts }>({
    streamed: null,
    live: NO_NAV_COUNTS,
  });
  const setStreamed = useCallback(
    (value: StreamedNav) =>
      setState({
        streamed: value,
        live: fullNavCounts(
          value.counts,
          value.runningCounts,
          value.newIssueRepos.map((repo) => repo.name),
          value.unreadableRepos,
        ),
      }),
    [],
  );
  const setRepoCount = useCallback(
    (feed: RepoCountFeed) =>
      setState((current) => {
        const live = applyRepoCount(current.live, feed, current.streamed?.renderedAt ?? null);
        return live === current.live ? current : { ...current, live };
      }),
    [],
  );
  const setPageCounts = useCallback(
    (page: Parameters<typeof withPageCounts>[1]) =>
      setState((current) => {
        const live = withPageCounts(current.live, page);
        return live === current.live ? current : { ...current, live };
      }),
    [],
  );
  // 設定で保存した監視リポジトリ：サーバーの一覧（`base.repos`）が新しくなるまで、保存した一覧を札に使う
  const [saved, setSaved] = useState<SavedRepos<DeskNav["repos"]> | null>(null);
  const baseRepos = base.repos;
  const applySavedRepos = useCallback(
    (names: unknown) => {
      const repos = parseSavedRepos(names);
      if (repos) setSaved({ repos, base: baseRepos });
    },
    [baseRepos],
  );
  // 同じブラウザの別タブで保存された一覧を受け取り、札をすぐ替えて、中身も取り直す（BroadcastChannel が無い環境では何もしない）
  const router = useRouter();
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    let channel: BroadcastChannel;
    try {
      channel = new BroadcastChannel(WATCHED_REPOS_CHANNEL);
    } catch {
      return;
    }
    channel.onmessage = (event: MessageEvent) => {
      if (!parseSavedRepos(event.data)) return;
      applySavedRepos(event.data);
      router.refresh();
    };
    return () => channel.close();
  }, [applySavedRepos, router]);
  const value = useMemo(
    () => ({
      base,
      streamed: state.streamed,
      live: state.live,
      saved,
      setStreamed,
      setRepoCount,
      setPageCounts,
      applySavedRepos,
    }),
    [base, state, saved, setStreamed, setRepoCount, setPageCounts, applySavedRepos],
  );
  return <NavContext.Provider value={value}>{children}</NavContext.Provider>;
}

/**
 * 左のバー用の情報。全部の件数がまだ届いていなければ `countsPending` が true で、
 * 届いたリポジトリ（`countsLoaded`）だけ件数を出す
 */
export function useNav(): (DeskNav & { countsPending: boolean; drift: DriftSummary | null }) | null {
  // `countsUnreadable`：読めなかったリポジトリ。札は残し、数は「–」
  const state = useContext(NavContext);
  return useMemo(() => {
    if (!state) return null;
    const { base, streamed, live, saved } = state;
    return {
      ...base,
      repos: [...reposToShow(base.repos, saved)],
      counts: live.counts,
      runningCounts: live.runningCounts,
      countsLoaded: live.loaded,
      countsUnreadable: live.unreadable,
      countsPending: streamed === null,
      // 全部を読み終えるまでは出さない（読み終えてから、取り込み済みの Issue で数える）
      drift: streamed?.drift ?? null,
    };
  }, [state]);
}

/** 後から届いた物（Issueを書く欄のリポジトリ・自動で足したお知らせ）。まだなら null */
export function useStreamedNav(): StreamedNav | null {
  return useContext(NavContext)?.streamed ?? null;
}

export function useSetStreamedNav(): ((value: StreamedNav) => void) | null {
  return useContext(NavContext)?.setStreamed ?? null;
}

/**
 * ページが全部を読み終えたら、そのページの件数を上のバー・左のバーへ入れる（`complete` が true のときだけ）。
 * layout は描き直されないので、入れないと移った先で件数が古いまま残る。デモ（Provider の外）では何もしない
 */
export function usePublishPageCounts(nav: DeskNav, complete: boolean): void {
  const state = useContext(NavContext);
  const setPageCounts = state?.setPageCounts;
  const { counts, runningCounts, countsUnreadable, countsPending } = nav;
  const baseRepos = state?.base.repos;
  useEffect(() => {
    if (!setPageCounts || !complete || countsPending || !baseRepos) return;
    setPageCounts({
      counts,
      runningCounts,
      unreadable: countsUnreadable ?? {},
      repoKeys: baseRepos.map((repo) => `${repo.owner}/${repo.repo}`.toLowerCase()),
    });
  }, [setPageCounts, complete, countsPending, counts, runningCounts, countsUnreadable, baseRepos]);
}

export function useSetRepoCount(): ((feed: RepoCountFeed) => void) | null {
  return useContext(NavContext)?.setRepoCount ?? null;
}

/** 設定で保存した監視リポジトリ（`owner/repo` の並び）を、札へすぐ反映する入口。デモ（Provider の外）では null */
export function useApplySavedRepos(): ((names: unknown) => void) | null {
  return useContext(NavContext)?.applySavedRepos ?? null;
}

/** 保存した監視リポジトリを、別タブへ知らせる（届かない環境では何もしない。次の取り直しで揃う） */
export function broadcastSavedRepos(names: string[]): void {
  if (typeof BroadcastChannel === "undefined") return;
  try {
    const channel = new BroadcastChannel(WATCHED_REPOS_CHANNEL);
    channel.postMessage(names);
    channel.close();
  } catch {
    // 届かなくても、次の取り直しで揃う
  }
}
