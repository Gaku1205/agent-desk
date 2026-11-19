"use client";

import { startTransition, useEffect, useState, type ComponentProps } from "react";
import type { Step } from "@/lib/steps";
import { Dashboard } from "./Dashboard";
import { Desk, type DeskNav } from "./Desk";
import { Lanes } from "./Lanes";
import { useNav, usePublishPageCounts } from "./NavContext";
import { NewIssueForm, type NewIssueRepo } from "./NewIssueForm";
import { RepoList } from "./RepoList";
import { NewServiceSkeleton } from "./Skeleton";
import { formatStaleTime, shouldHoldPrevious } from "@/lib/staleSnapshot";
import styles from "./LivePages.module.css";

// 全部のリポジトリを使うページの入れ物（docs/spec.md の「全部のリポジトリを待つページ」）。
// サーバーが先に返した段（覚えている最後の結果・読めた分）をすぐ描き、次の段が届くたびに、同じ部品の中身だけを入れ替える
// （部品は作り直さないので、開いた行・書きかけの文字・スクロールの位置は残る）。

/**
 * 段の列の、いま届いている最後の段の中身。次の段が届いたら、トランジションで入れ替える。
 * サーバーが描き直して新しい列（`first`）を渡したら、その最初の段からやり直す
 */
export function useSteps<T>(first: Step<T>, isFinal: (value: T) => boolean = () => false): T {
  const [reached, setReached] = useState<{ first: Step<T>; step: Step<T> }>({ first, step: first });
  // 一度出した中身は、新しい列（自動の取り直し）の最後の段がそろうまで消さない。
  // 新しい列の最初の段は、覚えていた古い結果や一部のリポジトリだけのことがあり、描くと席・行が減って見えてチカチカする
  const [shown, setShown] = useState<{ first: Step<T>; value: T }>({ first, value: first.value });
  const current = reached.first === first ? reached.step : first;
  const holdPrevious = shouldHoldPrevious(shown.first, first, current.value, isFinal);
  const value = holdPrevious ? shown.value : current.value;
  if (!holdPrevious && (shown.first !== first || shown.value !== current.value)) {
    // 描画の中で、出す中身を覚え直す（React の「前の値と比べて state を直す」書き方）
    setShown({ first, value: current.value });
  }
  useEffect(() => {
    const next = current.next;
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
  }, [first, current]);
  return value;
}

/**
 * ページの中身と、全部のリポジトリの新しい結果がそろった最後の段か。`staleAt` は、覚えている古い結果を出しているときの、
 * その内容の時刻（ISO）。`staleBecause` はその理由（新しい結果を待っている／読めなかった）
 */
export type LiveValue<P> = {
  props: P;
  complete: boolean;
  staleAt?: string | null;
  staleBecause?: "loading" | "unreadable" | null;
};

const isComplete = (value: { complete: boolean }): boolean => value.complete;

/**
 * 古い結果を出している間の1行（日本時間）。新しい結果を待っている間は `HH:MM 時点の内容です。新しい内容を読んでいます…`、
 * 読めなかったので覚えている結果を出し続けているときは `HH:MM 時点の内容です。GitHubから読めなかったため、前に読めた内容を出しています`
 * （最後の段でも消えない）
 */
function StaleNote({ staleAt, staleBecause, complete }: Omit<LiveValue<unknown>, "props">) {
  const unreadable = staleBecause === "unreadable";
  if ((complete && !unreadable) || !staleAt) return null;
  const time = formatStaleTime(staleAt);
  if (!time) return null;
  return (
    <p className={styles.staleNote} role="status">
      {unreadable
        ? `${time} 時点の内容です。GitHubから読めなかったため、前に読めた内容を出しています`
        : `${time} 時点の内容です。新しい内容を読んでいます…`}
    </p>
  );
}

/**
 * 左のバーの件数：全部がそろう前の段では、ページが数えた件数（読めた分だけ）ではなく、
 * layout が読み終えたリポジトリから順に流す件数を使う（札が出たり消えたりしないように）
 */
function useLiveNav(nav: DeskNav, complete: boolean): DeskNav {
  const live = useNav();
  usePublishPageCounts(nav, complete);
  if (complete || !live) return nav;
  return {
    ...nav,
    counts: live.counts,
    runningCounts: live.runningCounts,
    countsPending: live.countsPending,
    countsLoaded: live.countsLoaded,
    countsUnreadable: live.countsUnreadable,
  };
}

/** ホーム */
export function DeskLive({ first }: { first: Step<LiveValue<ComponentProps<typeof Desk>>> }) {
  const { props, complete, staleAt, staleBecause } = useSteps(first, isComplete);
  usePublishPageCounts(props.nav, complete);
  return (
    <>
      <Desk {...props} />
      <StaleNote staleAt={staleAt} staleBecause={staleBecause} complete={complete} />
    </>
  );
}

/** Slots & Queue */
export function LanesLive({ first }: { first: Step<LiveValue<ComponentProps<typeof Lanes>>> }) {
  const { props, complete, staleAt, staleBecause } = useSteps(first, isComplete);
  const nav = useLiveNav(props.nav, complete);
  return (
    <>
      <Lanes {...props} nav={nav} />
      <StaleNote staleAt={staleAt} staleBecause={staleBecause} complete={complete} />
    </>
  );
}

/** Dashboard */
export function DashboardLive({ first }: { first: Step<LiveValue<ComponentProps<typeof Dashboard>>> }) {
  const { props, complete, staleAt, staleBecause } = useSteps(first, isComplete);
  const nav = useLiveNav(props.nav, complete);
  return (
    <>
      <Dashboard {...props} nav={nav} />
      <StaleNote staleAt={staleAt} staleBecause={staleBecause} complete={complete} />
    </>
  );
}

/**
 * 新しいサービスを作る。送り先（テンプレート）は読めたリポジトリから決まるので、
 * まだ1つも見つからない間は骨組みを出し、「テンプレートが監視にありません」を先に見せない
 */
export function NewServiceLive({
  first,
}: {
  first: Step<LiveValue<{ repos: NewIssueRepo[]; nav: DeskNav }>>;
}) {
  const { props, complete } = useSteps(first, isComplete);
  const nav = useLiveNav(props.nav, complete);
  if (!complete && props.repos.length === 0) return <NewServiceSkeleton />;
  return <NewIssueForm mode="service" repos={props.repos} nav={nav} />;
}

/** すべてのリポジトリ */
export function RepoListLive({ first }: { first: Step<LiveValue<ComponentProps<typeof RepoList>>> }) {
  const { props, complete, staleAt, staleBecause } = useSteps(first, isComplete);
  const nav = useLiveNav(props.nav, complete);
  return (
    <>
      <RepoList {...props} nav={nav} />
      <StaleNote staleAt={staleAt} staleBecause={staleBecause} complete={complete} />
    </>
  );
}
