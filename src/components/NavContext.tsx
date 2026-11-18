"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { AddedNotice } from "@/lib/autoAdd";
import type { TurnCounts } from "@/lib/turn";
import type { NewIssueRepo } from "./NewIssueForm";
import type { DeskNav } from "./Desk";

/** 全リポジトリを読み終えてから届く物（layout が Suspense で後から流す） */
export type StreamedNav = {
  counts: TurnCounts;
  runningCounts: TurnCounts;
  newIssueRepos: NewIssueRepo[];
  addedNotices: AddedNotice[];
};

type NavState = {
  /** 左のバー用の、件数以外の情報（すぐ分かる） */
  base: DeskNav;
  /** 全リポジトリを読み終えたら入る。それまでは null（件数は「–」） */
  streamed: StreamedNav | null;
  setStreamed: (value: StreamedNav) => void;
};

const NavContext = createContext<NavState | null>(null);

/**
 * 左のバー用の情報（リポジトリ・件数・ユーザー）を、layout から上端の帯・読み込み中の骨組み・リポジトリのページへ渡す。
 * 件数など他のリポジトリの読み込みを待つ物は後から入る（`NavFeed` が `setStreamed` で入れる）
 */
export function NavProvider({ base, children }: { base: DeskNav; children: ReactNode }) {
  const [streamed, setStreamedState] = useState<StreamedNav | null>(null);
  const setStreamed = useCallback((value: StreamedNav) => setStreamedState(value), []);
  const value = useMemo(() => ({ base, streamed, setStreamed }), [base, streamed, setStreamed]);
  return <NavContext.Provider value={value}>{children}</NavContext.Provider>;
}

/** 左のバー用の情報。件数がまだ届いていなければ `countsPending` が true（件数は空） */
export function useNav(): (DeskNav & { countsPending: boolean }) | null {
  const state = useContext(NavContext);
  return useMemo(() => {
    if (!state) return null;
    const { base, streamed } = state;
    return {
      ...base,
      counts: streamed?.counts ?? base.counts,
      runningCounts: streamed?.runningCounts ?? base.runningCounts,
      countsPending: streamed === null,
    };
  }, [state]);
}

/** 後から届いた物（件数・Issueを書く欄のリポジトリ・自動で足したお知らせ）。まだなら null */
export function useStreamedNav(): StreamedNav | null {
  return useContext(NavContext)?.streamed ?? null;
}

export function useSetStreamedNav(): ((value: StreamedNav) => void) | null {
  return useContext(NavContext)?.setStreamed ?? null;
}
