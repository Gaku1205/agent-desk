"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { deskKeyAction, skipKey, stepKey } from "@/lib/deskKeys";
import type { AddedNotice } from "@/lib/autoAdd";
import type { ChatMessage } from "@/lib/conversation";
import { applyStepLog, hideUnknownModels } from "@/lib/flow";
import { isNearBottom, openPosition, shouldFollow } from "@/lib/followScroll";
import { pickFlowTarget, toggleFlowSelection } from "@/lib/flowTarget";
import type { StepInfo } from "@/lib/stepLog";
import { formatWait, turnItemKey, type TurnCounts, type TurnItem } from "@/lib/turn";
import type { WatchdogNotice } from "@/lib/watchdogState";
import { Conversation, type ConversationNotice } from "./Conversation";
import { useNav, useStreamedNav } from "./NavContext";
import styles from "./Desk.module.css";
import { FlowMap } from "./FlowMap";
import { NewIssueForm, type NewIssueRepo } from "./NewIssueForm";
import type { TopBarRepo } from "./TopBar";
import { TurnList } from "./TurnList";
import { TurnRow } from "./TurnRow";
import { HomeCalm } from "./HomeCalm";
import { HomeLater } from "./HomeLater";
import { TurnSheet } from "./TurnSheet";
import type { HomeActivity } from "@/lib/lanes/source";
import { pickTurn } from "@/lib/turnList";
import { isMergeQueueItem, MERGE_QUEUE_FROM, orderMergeQueue } from "@/lib/mergeOrder";
import { withHeldRows, type HeldRow } from "@/lib/operationResult";
import { awaySummary, parseLastSeen, AWAY_MIN_MS, type AwayEvent } from "@/lib/awaySummary";
import { readLastSeen, writeLastSeen } from "@/lib/lastSeen";
import { AwaySummary } from "./AwaySummary";

export type DeskScope =
  | { kind: "all"; repoCount: number }
  | { kind: "repo"; owner: string; repo: string; githubUrl: string | null };

export type DeskError = { repo: string; message: string; work?: true };

type Props = {
  items: TurnItem[];
  messages: ChatMessage[];
  /** 「今」（ISO文字列） */
  now: string;
  scope: DeskScope;
  /** 取れなかったリポジトリ */
  errors: DeskError[];
  /** 見張り役が止まっているリポジトリ */
  notices: WatchdogNotice[];
  /** 自動で監視に足したリポジトリ（足してから24時間） */
  addedNotices?: AddedNotice[];
  /** PCの3ペインの左：リポジトリの一覧 */
  nav: DeskNav;
  /** PCの3ペインの中央の下：Issueを追加する入力欄のリポジトリ */
  newIssueRepos: NewIssueRepo[];
  /** 進捗図の「モデル名と所要時間」を読む（サーバーの処理）。デモは渡さない（記録が無い扱い） */
  loadStepLog?: (owner: string, repo: string, number: number) => Promise<StepInfo[]>;
  /** デモ：記録が無い工程の「不明」を出さない（本物は出す） */
  hideUnknownModel?: boolean;
  /** 全部のリポジトリの新しい結果がそろった（無ければそろっている） */
  settled?: boolean;
  /** ホームの上端の帯の右の1行：実装中（枠を使っている作業）と順番待ちの数（Slots & Queue と同じ数え方）。無ければ出さない */
  activity?: HomeActivity | null;
  /** ホームの「いない間のまとめ」を数える出来事（取得済みの直近3日の公開・止まり）。無ければ出さない */
  awayEvents?: AwayEvent[];
};

export type DeskNav = {
  repos: TopBarRepo[];
  counts: TurnCounts;
  runningCounts: TurnCounts;
  /** 件数がまだ届いていない。true のとき、件数・Issueを書く欄・自動で足したお知らせは layout が後から流す物を使う */
  countsPending?: boolean;
  /** 全部が届く前に、件数が届いたリポジトリ（`owner/repo` の小文字）。届いた物だけ件数を出し、ほかは「–」 */
  countsLoaded?: Record<string, true>;
  /** 読めなかったリポジトリ（`owner/repo` の小文字）。札は残し、数は 0 ではなく「–」 */
  countsUnreadable?: Record<string, true>;
  /** リンクの頭（デモでは `/demo`） */
  basePath?: string;
  /** 左のバーのいちばん下：ログイン中のユーザー名とログアウト（デモでは無し） */
  login?: string;
  logout?: () => Promise<void>;
};

/** ページのいちばん下へ即座に移す */
function scrollToBottom(): void {
  window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" });
}

/** マージ待ちが2件以上で、大きい1件がマージ待ちの番なら、その1件の代わりに出す「すすめる順」の一覧（強い色の物が先にある間は出さない） */
function mergeQueueOf(waiting: TurnItem[], current: TurnItem | null): TurnItem[] {
  const mergeWaiting = waiting.filter(isMergeQueueItem);
  return current && isMergeQueueItem(current) && mergeWaiting.length >= MERGE_QUEUE_FROM
    ? orderMergeQueue(mergeWaiting)
    : [];
}

/** 1件の中の、最初のボタン（無ければ最初のリンク） */
function firstControl(row: Element | null | undefined): HTMLElement | null {
  return (
    row?.querySelector<HTMLElement>('[data-act]:not([aria-disabled="true"])') ??
    row?.querySelector<HTMLElement>("a, button") ??
    null
  );
}

/**
 * ホームとリポジトリのページの中身：1本の列に、上に「あなたの番」の1件、下に「いまの様子」（会話）。
 * 本物もデモも同じ物（docs/design.md の「構図」）
 */
export function Desk({
  items,
  messages,
  now,
  scope,
  errors,
  notices,
  addedNotices: addedNoticesProp = [],
  nav: navProp,
  newIssueRepos: newIssueReposProp,
  loadStepLog,
  hideUnknownModel = false,
  activity = null,
  awayEvents = [],
  settled = true,
}: Props) {
  // リポジトリのページは中央の中身を先に出すので、件数など他のリポジトリを待つ物は layout が後から流す。
  // 件数は読み終えたリポジトリから順に入る（届くまでは「–」）
  const streamed = useStreamedNav();
  const live = useNav();
  const deferred = navProp.countsPending === true;
  const nav: DeskNav = {
    ...navProp,
    counts: deferred && live ? live.counts : navProp.counts,
    runningCounts: deferred && live ? live.runningCounts : navProp.runningCounts,
    countsLoaded: deferred && live ? live.countsLoaded : undefined,
    countsUnreadable: deferred && live ? live.countsUnreadable : navProp.countsUnreadable,
    countsPending: deferred && (live ? live.countsPending : true),
  };
  const newIssueRepos = deferred && streamed ? streamed.newIssueRepos : newIssueReposProp;
  const addedNotices =
    deferred && streamed && scope.kind === "repo"
      ? streamed.addedNotices.filter(
          (notice) =>
            notice.owner.toLowerCase() === scope.owner.toLowerCase() &&
            notice.repo.toLowerCase() === scope.repo.toLowerCase(),
        )
      : deferred && streamed
        ? streamed.addedNotices
        : addedNoticesProp;

  const rowsRef = useRef<HTMLDivElement>(null);
  // ホームは、待ちが1件以上の間は入力欄を出さない（0件の画面は続きの Issue。それまでは今の出し方）
  const showComposer = scope.kind !== "all" || items.length === 0;
  // 入力欄の高さを測って --composer-h に入れる（html の scroll-padding-bottom が使う）。離れたら消す
  const composerRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    const root = document.documentElement;
    const apply = () => root.style.setProperty("--composer-h", `${el.offsetHeight}px`);
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.style.removeProperty("--composer-h");
    };
  }, [showComposer]);
  // 操作が通って片づけた1件。取り直しを待たずに次の1件に替え、件数を減らす（取り直しで消えたら自然に数えなくなる）
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(() => new Set());
  // 押してから片づけるまでの1件（押した時点の中身と位置）。取り直しで消えても、結果を見せ終えるまで同じ場所に残す
  const [held, setHeld] = useState<ReadonlyMap<string, HeldRow<TurnItem>>>(() => new Map());
  const itemsRef = useRef(items);
  useLayoutEffect(() => {
    itemsRef.current = items;
  }, [items]);
  // 片づけた1件の中にフォーカスがあった（見出しへ移した）。次の1件が出たら、その最初のボタンへ移す
  const focusNext = useRef(false);
  const all = withHeldRows(items, held);
  // 画面に出す物（結果を見せている1件も、見せ終えるまで同じ場所に出す）
  const shown = all.filter((item) => !leaving.has(turnItemKey(item)));
  // 数える物（結果を出し始めた1件は、もう数えない）
  const waiting = shown.filter((item) => held.get(turnItemKey(item))?.done !== true);
  // 一覧で選んだ1件（`owner/repo#番号`）。その画面にいる間だけ覚え、片づいたら並び順の先頭に戻る
  const [picked, setPicked] = useState<string | null>(null);
  const current = pickTurn(shown, picked);
  const currentKey = current ? turnItemKey(current) : null;
  const queue = mergeQueueOf(shown, current);
  const queueKeys = new Set(queue.map(turnItemKey));
  const home = scope.kind === "all";
  // 右の Your turn の列のキーの並び（J / K・S で動かす）。最新の物をキー操作から読む
  const waitingKeys = waiting.map(turnItemKey);
  const keysRef = useRef({ current: currentKey, keys: waitingKeys });
  useLayoutEffect(() => {
    keysRef.current = { current: currentKey, keys: waitingKeys };
  });
  // 開いたときの1件はフェードしない。替わった1件だけ短くフェードする
  const [firstKey] = useState(currentKey);

  // いない間のまとめ：開いた最初の1回だけ判定する。前に見た時刻と開いた時刻は、そのとき値で固定する（その後は更新しない）
  const [away, setAway] = useState<{ lastSeen: string; openedAt: number } | null>(null);
  const judged = useRef(false);
  const awayOpen = useRef(false);
  const dismissAway = useCallback(() => {
    if (!awayOpen.current) return;
    awayOpen.current = false;
    writeLastSeen(new Date());
    setAway(null);
  }, []);
  useEffect(() => {
    if (!home || judged.current) return;
    judged.current = true;
    const openedAt = Date.now();
    const lastSeen = readLastSeen();
    const since = parseLastSeen(lastSeen, new Date(openedAt));
    if (lastSeen !== null && since !== null && openedAt - since >= AWAY_MIN_MS) {
      awayOpen.current = true;
      queueMicrotask(() => setAway({ lastSeen, openedAt }));
    } else {
      // 出さないときは、開いた時刻を「前に見た時刻」にする
      writeLastSeen(new Date(openedAt));
    }
  }, [home]);
  const awayResult = away ? awaySummary(away.lastSeen, new Date(away.openedAt), awayEvents, items) : null;
  // 数がそろっても全部0件なら、出さずに今の時刻を覚える
  useEffect(() => {
    if (away && settled && awayResult === null) dismissAway();
  }, [away, settled, awayResult, dismissAway]);

  const leave = useCallback((key: string, on: boolean) => {
    if (on) dismissAway();
    if (on && document.activeElement?.id === "turn-title") focusNext.current = true;
    setLeaving((prev) => {
      if (prev.has(key) === on) return prev;
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  }, [dismissAway]);

  // 押してから片づけるまで、その1件の中身を預かる（位置は押した時点の並び）。done は件数から外す印
  const hold = useCallback((key: string, value: { item: TurnItem; done: boolean } | null) => {
    setHeld((prev) => {
      const before = prev.get(key);
      if (value === null) {
        if (!before) return prev;
        const next = new Map(prev);
        next.delete(key);
        return next;
      }
      if (before && before.done === value.done) return prev;
      const index = before?.index ?? itemsRef.current.findIndex((item) => turnItemKey(item) === key);
      const next = new Map(prev);
      next.set(key, { item: before?.item ?? value.item, index: Math.max(index, 0), done: value.done });
      return next;
    });
  }, []);

  // 一覧の行を選んだ：その行は大きい方に移るので、フォーカスも大きい1件の最初のボタンへ移す
  const pick = useCallback((key: string) => {
    focusNext.current = true;
    setPicked(key);
  }, []);

  // スマホの `飛ばす`：右の列の次の1件を真ん中に出す（S キーと同じ）
  const skip = useCallback(() => {
    const { current: key, keys } = keysRef.current;
    const to = skipKey(keys, key);
    if (to !== null && to !== key) setPicked(to);
  }, []);

  // スマホの `このあと` の行：その1件を真ん中に出して、上へ戻る
  // （上へ戻すのではなく、フォーカスを移す副作用が、その1件を上端の帯の下まで見せる）
  const pickLater = pick;

  // 決める画面のキー（docs/spec.md の「ホーム（決める画面）」）：1〜9 で選ぶ・Enter で答える・S で飛ばす・J / K で右の列を上下
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented) return;
      // ダイアログ（キーボード操作の一覧・画像の全体表示・開いたメニュー）が開いている間は効かせない
      const modal = Array.from(document.querySelectorAll('[aria-modal="true"]')).some((el) => !el.closest("[inert]"));
      if (modal) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      const typing =
        target !== null && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
      const onControl = target !== null && target.closest("a, button") !== null && target.closest('[role="radio"]') === null;
      const action = deskKeyAction({
        key: event.key,
        ctrlKey: event.ctrlKey,
        altKey: event.altKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
        isComposing: event.isComposing,
        repeat: event.repeat,
        typing,
        onControl,
      });
      if (!action) return;
      const { current: key, keys } = keysRef.current;
      if (action.type === "skip" || action.type === "move") {
        const to = action.type === "skip" ? skipKey(keys, key) : stepKey(keys, key, action.delta);
        if (to === null) return;
        event.preventDefault();
        if (to !== key) setPicked(to);
        return;
      }
      if (key === null) return;
      const card = rowsRef.current?.querySelector<HTMLElement>(`article[data-key="${CSS.escape(key)}"]:not([data-leaving])`);
      if (!card) return;
      if (action.type === "choose") {
        const groups = Array.from(card.querySelectorAll<HTMLElement>("[data-choices]"));
        const group = groups.find((g) => g.contains(document.activeElement)) ?? groups[0];
        const radio = group?.querySelectorAll<HTMLElement>('[role="radio"]')[action.index];
        if (!radio) return;
        event.preventDefault();
        if (radio.getAttribute("aria-checked") !== "true") radio.click();
        radio.focus();
        return;
      }
      const primary = card.querySelector<HTMLElement>('[data-primary]:not([aria-disabled="true"])');
      if (!primary) return;
      event.preventDefault();
      primary.click();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // 上端の帯の右の「動いている作業」の1行の置き場（TopBar の `#top-activity`）。ホームだけ
  const [activitySlot, setActivitySlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!home) return;
    queueMicrotask(() => setActivitySlot(document.getElementById("top-activity")));
  }, [home]);

  useEffect(() => {
    if (!focusNext.current) return;
    focusNext.current = false;
    if (currentKey === null) return;
    const row = rowsRef.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(currentKey)}"]`);
    // 答える欄がある1件は、選んでいる選択肢（無ければ最初）。ほかは最初のボタン
    const target = row?.querySelector<HTMLElement>('[role="radio"][tabindex="0"]') ?? firstControl(row);
    target?.focus({ preventScroll: true });
    // 1件の上端を、上端の帯のすぐ下（scroll-padding-top）に置いて、フォーカスを画面の中に見せる
    row?.scrollIntoView({ block: "start", behavior: "instant" });
  }, [currentKey]);

  // 中央は上が古く下が新しい。開いたとき・リポジトリを切り替えたときはいちばん下で始め、
  // 取り直しでは、いちばん下にいる間だけ追従する（さかのぼり中は動かさない）
  const scopeKey = scope.kind === "all" ? "all" : `${scope.owner}/${scope.repo}`;
  const followBottom = useRef(true);
  useEffect(() => {
    const update = () => {
      const root = document.documentElement;
      // ホームは会話が無いので、下へ追従しない
      followBottom.current = !home && isNearBottom(root.scrollHeight, window.scrollY, window.innerHeight);
    };
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, [home]);
  useLayoutEffect(() => {
    const place = () => {
      const root = document.documentElement;
      const answer = rowsRef.current?.querySelector<HTMLElement>("[data-answer]") ?? null;
      // ホームには会話が無いので、いちばん下では始めない（答える欄があればその1件の上端、無ければ上から）
      const position = home
        ? answer
          ? "answer"
          : "top"
        : openPosition(root.scrollHeight, window.innerHeight, answer !== null);
      if (position === "answer" && answer) {
        // 上端の帯の下（scroll-padding-top）に、その1件の上端（種類の札と題名）を置く
        answer.scrollIntoView({ block: "start", behavior: "instant" });
      } else if (position === "bottom") {
        scrollToBottom();
      } else {
        window.scrollTo({ top: 0, behavior: "instant" });
      }
      followBottom.current = !home && (position === "bottom" || position === "top");
    };
    place();
    // 答える欄がある1件は、最初の選択肢（キー操作の決まりで Tab が止まる物）にフォーカスを置く
    rowsRef.current
      ?.querySelector<HTMLElement>('[data-answer] [role="radio"][tabindex="0"]')
      ?.focus({ preventScroll: true });
    // ページを移ったあとの、Next の「上へ戻す」より後にもう一度送る
    const frame = requestAnimationFrame(place);
    return () => cancelAnimationFrame(frame);
  }, [scopeKey, home]);
  useLayoutEffect(() => {
    const answering = rowsRef.current?.contains(document.activeElement) === true &&
      document.activeElement?.closest("[data-answer]") != null;
    if (shouldFollow(followBottom.current, answering)) scrollToBottom();
  }, [messages, items]);

  const at = new Date(now);
  const conversationNotices: ConversationNotice[] = [
    ...notices.map((notice) => ({
      key: `watchdog:${notice.owner}/${notice.repo}`,
      tone: "warn" as const,
      text: `${scope.kind === "all" ? `${notice.repo}　` : ""}見張り役（止まった作業を見つける仕組み）が ${notice.hours}h 動いていません。止まった作業に気づけないことがあります。Actions を確認してください`,
      title: "Actions が止まっていないか確認してください",
    })),
    ...errors.map((error) => ({ key: `error:${error.repo}`, tone: "fail" as const, text: `${error.repo}：${error.message}` })),
  ];

  // 読めなかったリポジトリがあるときは、「何も無い」と言い切らない（docs/spec.md の「読めなかったリポジトリは、空ではなく読めなかったと出す」）
  const unreadable = errors.length > 0;
  const showRepo = scope.kind === "all" && scope.repoCount > 1;
  // 「いまの様子」で選んだ行（`owner/repo#番号`）。同じ行をもう一度選ぶと外す。選んでいなければ今まで通りの1件を描く
  const [selected, setSelected] = useState<string | null>(null);
  const select = useCallback((key: string) => setSelected((prev) => toggleFlowSelection(prev, key)), []);
  const pickedTarget = pickFlowTarget(current, messages, showRepo, selected);
  // 選んだ行がもう無い（取り直しで消えた）ときは、選んでいない扱い
  const selectedKey = selected !== null && messages.some((message) => message.key === selected) ? selected : null;
  const targetKey = pickedTarget ? `${pickedTarget.owner}/${pickedTarget.repo}#${pickedTarget.number}` : null;
  // 進捗ログ（モデル名と所要時間）。取れるまでは骨組みの帯、取れないときは「不明」。データを取り直したら読み直す
  const [stepLog, setStepLog] = useState<{ key: string; infos: StepInfo[] } | null>(null);
  useEffect(() => {
    // ホームには進捗図を出さないので読まない
    if (home || !loadStepLog || !pickedTarget || targetKey === null) return;
    let cancelled = false;
    loadStepLog(pickedTarget.owner, pickedTarget.repo, pickedTarget.number)
      .then((infos) => {
        if (!cancelled) setStepLog({ key: targetKey, infos });
      })
      .catch(() => {
        // 読めなかったときも、読み込み中は外す（記録が無い扱い）
        if (!cancelled) setStepLog({ key: targetKey, infos: [] });
      });
    return () => {
      cancelled = true;
    };
    // pickedTarget は毎回作り直されるので、中身を表す targetKey と now で見る
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadStepLog, targetKey, now]);
  // 読み込み中（帯）にするのは、進捗ログを読む画面（loadStepLog あり）で、まだ読み終えていないときだけ
  const loadedTarget =
    pickedTarget && stepLog?.key === targetKey
      ? { ...pickedTarget, flow: applyStepLog(pickedTarget.flow, stepLog.infos), stepLog: stepLog.infos }
      : pickedTarget && !loadStepLog
        ? { ...pickedTarget, flow: applyStepLog(pickedTarget.flow, []) }
        : pickedTarget;
  const flowTarget =
    loadedTarget && hideUnknownModel ? { ...loadedTarget, flow: hideUnknownModels(loadedTarget.flow) } : loadedTarget;

  const conversation = (
    <Conversation
      messages={messages}
      now={now}
      showRepo={showRepo}
      repo={scope.kind === "repo" ? { name: scope.repo, githubUrl: scope.githubUrl } : null}
      notices={conversationNotices}
      unreadable={unreadable}
      added={addedNotices}
      selected={selectedKey}
      onSelect={select}
      loadStepLog={loadStepLog}
      hideUnknownModel={hideUnknownModel}
      repoOrder={nav.repos.map((r) => `${r.owner}/${r.repo}`)}
    />
  );

  // 右の Your turn の列（待っている物の全部。真ん中の1件も含む）
  const side =
    waiting.length > 0 ? (
      <TurnList items={waiting} currentKey={currentKey} now={at} count={waiting.length} onPick={pick} />
    ) : null;

  // ホームで待ちが0件：緑のチェックと「いま動いている」の画面（docs/design.md の「ホーム：待ちが0件」）
  const calm = home && !current;
  const turn = (
      <section
        className={styles.turn}
        data-empty={current || calm ? undefined : ""}
        data-calm={calm ? "" : undefined}
        data-after-away={away && awayResult ? "" : undefined}
        aria-labelledby="turn-title"
        data-skip-target=""
      >
        {calm ? (
          <HomeCalm activity={activity} unreadable={unreadable} base={nav.basePath ?? ""} />
        ) : (
          <>
            <div className={styles.head} data-hidden={current ? "" : undefined}>
              <h1 className={styles.h1} id="turn-title" tabIndex={-1}>
                {current ? "Your turn" : unreadable ? "読めなかったリポジトリがあります" : "いまは AI が進めています"}
              </h1>
            </div>
            {!current && (
              <p className={styles.calm}>
                {unreadable ? "読めなかったリポジトリの分は、ここに入っていません" : "あなたが答えることはありません"}
              </p>
            )}
          </>
        )}

        {queue.length > 0 && (
          <h2 className={styles.queueHead} id="merge-queue-title">
            マージ待ち <span className="num">{queue.length}</span>件（この順に押す）
          </h2>
        )}
        {/* 一覧のときだけ、順番つきの一覧として読ませる（片づけて隠した1件も同じ親に残すので、要素は替えずに役割だけ付ける） */}
        <div
          ref={rowsRef}
          role={queue.length > 0 ? "list" : undefined}
          aria-labelledby={queue.length > 0 ? "merge-queue-title" : undefined}
        >
          {[...queue, ...all.filter((item) => !queueKeys.has(turnItemKey(item)))].map((item) => {
            const key = turnItemKey(item);
            const queueIndex = queue.findIndex((q) => turnItemKey(q) === key);
            // 出すのは今の1件（または一覧の行）と、片づけて隠している1件（取り直しで消えるまで、戻せるように残す）だけ
            if (queueIndex < 0 && key !== currentKey && !leaving.has(key)) return null;
            return (
              <TurnRow
                key={key}
                item={item}
                wait={formatWait(item.waitingSince, at)}
                fresh={queueIndex < 0 && key === currentKey && key !== firstKey}
                onLeave={leave}
                onHold={hold}
                queue={queueIndex >= 0 ? { num: queueIndex + 1 } : undefined}
                home={home}
                onSkip={home && waiting.length > 1 ? skip : undefined}
              />
            );
          })}
        </div>
      </section>
  );

  const composer = showComposer ? (
    <div className={styles.composer} ref={composerRef}>
      <NewIssueForm
        variant="bar"
        newServiceHref={`${nav.basePath ?? ""}/new/service`}
        repos={newIssueRepos}
        initialRepo={scope.kind === "repo" ? `${scope.owner}/${scope.repo}` : undefined}
      />
    </div>
  ) : null;

  if (home) {
    // ホーム（決める画面。docs/design.md の「ホーム（決める画面）」）：真ん中に今の1件・右に Your turn の全部。
    // 会話・過去の欄・進捗図は出さない。動いている作業は上端の帯の右に1行だけ
    const base = nav.basePath ?? "";
    return (
      <div className={styles.panes} data-panes="" data-single={side ? undefined : ""}>
        <div className={styles.center}>
          <main className={styles.desk} id="main">
            {conversationNotices.length > 0 && (
              <ul className={styles.notices}>
                {conversationNotices.map((notice) => (
                  <li key={notice.key} data-tone={notice.tone} title={notice.title}>
                    {notice.text}
                  </li>
                ))}
              </ul>
            )}
            {away && awayResult && (
              <AwaySummary
                summary={awayResult}
                lastSeen={away.lastSeen}
                now={new Date(away.openedAt)}
                dashboardHref={`${base}/dashboard`}
                onDismiss={dismissAway}
              />
            )}
            {turn}
            {current && (
              <HomeLater
                items={waiting.filter((item) => turnItemKey(item) !== currentKey)}
                onPick={pickLater}
                activity={activity}
                base={base}
              />
            )}
          </main>
          {composer}
        </div>
        {side && <div className={styles.side}>{side}</div>}
        {waiting.length > 0 && (
          <TurnSheet items={waiting} currentKey={currentKey} now={at} count={waiting.length} onPick={pick} />
        )}
        {activitySlot &&
          activity &&
          createPortal(
            <Link
              href={`${base}/lanes`}
              className={`${styles.activity} num`}
              aria-label={`実装中 ${activity.running}、順番待ち ${activity.queued}。Slots & Queue を開く`}
            >
              <span className={styles.activityDot} aria-hidden="true" />
              <span className={styles.activityLabel}>実装中 </span>
              {activity.running} ·{" "}
              <span className={styles.activityLabel}>順番待ち </span>
              {activity.queued} ·{" "}
              <span className={styles.activityLanes}>Slots &amp; Queue </span>→
            </Link>,
            activitySlot,
          )}
      </div>
    );
  }

  // リポジトリのページ：中央に会話と Your turn（真ん中の1件＋そのリポジトリの Your turn の列）と入力欄、右に進捗図の列
  return (
    <div className={styles.panes} data-panes="">
      <div className={styles.center}>
        <main className={styles.desk} id="main">
          {conversation}
          <div className={styles.repoDecide} data-single={side ? undefined : ""}>
            {turn}
            {side && <div className={styles.repoSide}>{side}</div>}
          </div>
        </main>
        {composer}
      </div>
      <div className={styles.flow}>
        <FlowMap target={flowTarget} unreadable={unreadable} />
      </div>
    </div>
  );
}
