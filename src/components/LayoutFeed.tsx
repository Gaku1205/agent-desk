"use client";

import { useEffect } from "react";
import { useSetShellPlan, type ShellPlan } from "./AppShell";
import { useSetStreamedNav, type StreamedNav } from "./NavContext";

/**
 * 全リポジトリを読み終えてから届く物（自動更新の計画・左のバーの件数など）を、画面の入れ物へ渡す。
 * 何も描かない。layout が Suspense の中に置くので、これを待たずに中央の中身が出る
 */
export function LayoutFeed({ plan, streamed }: { plan: ShellPlan; streamed: StreamedNav }) {
  const setPlan = useSetShellPlan();
  const setStreamed = useSetStreamedNav();
  // 取り直しのたびにサーバーが新しい物を渡す（描き直しのときだけ効果が走る）
  useEffect(() => {
    setPlan?.(plan);
    setStreamed?.(streamed);
  }, [plan, streamed, setPlan, setStreamed]);
  return null;
}
