"use client";

import { useNav } from "./NavContext";
import { TopBar } from "./TopBar";

/** 本物の画面の上端の帯。リポジトリ・件数は layout の入れ物から読む（件数は後から届く） */
export function AppTopBar() {
  const nav = useNav();
  if (!nav) return null;
  return (
    <TopBar
      repos={nav.repos}
      counts={nav.counts}
      runningCounts={nav.runningCounts}
      countsPending={nav.countsPending}
      login={nav.login}
      logout={nav.logout}
    />
  );
}
