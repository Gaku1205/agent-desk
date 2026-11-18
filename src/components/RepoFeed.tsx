"use client";

import { useEffect } from "react";
import { useSetRepoCount } from "./NavContext";

/**
 * 1つのリポジトリを読み終えた時点の件数を、画面の入れ物（`NavProvider`）へ渡す。何も描かない。
 * layout がリポジトリごとの Suspense の中に置くので、読み終えたリポジトリから順に、左のバー・上端の帯の件数が入れ替わる
 */
export function RepoFeed({ repoKey, turn, running, renderedAt }: { repoKey: string; turn: number; running: number; renderedAt: string }) {
  const setRepoCount = useSetRepoCount();
  useEffect(() => {
    setRepoCount?.({ key: repoKey, turn, running, renderedAt });
  }, [repoKey, turn, running, renderedAt, setRepoCount]);
  return null;
}
