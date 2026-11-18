"use client";

import { startTransition, useEffect, useState, type ComponentProps } from "react";
import type { Step } from "@/lib/steps";
import { Dashboard } from "./Dashboard";
import { Desk, type DeskNav } from "./Desk";
import { Lanes } from "./Lanes";
import { useNav } from "./NavContext";
import { RepoList } from "./RepoList";

// 全部のリポジトリを使うページの入れ物（docs/spec.md の「全部のリポジトリを待つページ」）。
// サーバーが先に返した段（覚えている最後の結果・読めた分）をすぐ描き、次の段が届くたびに、同じ部品の中身だけを入れ替える
// （部品は作り直さないので、開いた行・書きかけの文字・スクロールの位置は残る）。

/**
 * 段の列の、いま届いている最後の段の中身。次の段が届いたら、トランジションで入れ替える。
 * サーバーが描き直して新しい列（`first`）を渡したら、その最初の段からやり直す
 */
export function useSteps<T>(first: Step<T>): T {
  const [reached, setReached] = useState<{ first: Step<T>; step: Step<T> }>({ first, step: first });
  const step = reached.first === first ? reached.step : first;
  useEffect(() => {
    const next = step.next;
    if (!next) return;
    let alive = true;
    next.then(
      (arrived) => {
        if (alive) startTransition(() => setReached({ first, step: arrived }));
      },
      // 次の段が届かなかった（通信が切れた）ときは、今の段のまま。次の取り直しで揃う
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [first, step]);
  return step.value;
}

/** ページの中身と、全部のリポジトリの新しい結果がそろった最後の段か */
export type LiveValue<P> = { props: P; complete: boolean };

/**
 * 左のバーの件数：全部がそろう前の段では、ページが数えた件数（読めた分だけ）ではなく、
 * layout が読み終えたリポジトリから順に流す件数を使う（札が出たり消えたりしないように）
 */
function useLiveNav(nav: DeskNav, complete: boolean): DeskNav {
  const live = useNav();
  if (complete || !live) return nav;
  return {
    ...nav,
    counts: live.counts,
    runningCounts: live.runningCounts,
    countsPending: live.countsPending,
    countsLoaded: live.countsLoaded,
  };
}

/** ホーム */
export function DeskLive({ first }: { first: Step<LiveValue<ComponentProps<typeof Desk>>> }) {
  const { props } = useSteps(first);
  return <Desk {...props} />;
}

/** Slots & Queue */
export function LanesLive({ first }: { first: Step<LiveValue<ComponentProps<typeof Lanes>>> }) {
  const { props, complete } = useSteps(first);
  return <Lanes {...props} nav={useLiveNav(props.nav, complete)} />;
}

/** Dashboard */
export function DashboardLive({ first }: { first: Step<LiveValue<ComponentProps<typeof Dashboard>>> }) {
  const { props, complete } = useSteps(first);
  return <Dashboard {...props} nav={useLiveNav(props.nav, complete)} />;
}

/** すべてのリポジトリ */
export function RepoListLive({ first }: { first: Step<LiveValue<ComponentProps<typeof RepoList>>> }) {
  const { props, complete } = useSteps(first);
  return <RepoList {...props} nav={useLiveNav(props.nav, complete)} />;
}
