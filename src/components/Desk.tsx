"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { AddedNotice } from "@/lib/autoAdd";
import type { ChatMessage } from "@/lib/conversation";
import { applyStepLog, hideUnknownModels } from "@/lib/flow";
import { isNearBottom, openPosition, shouldFollow } from "@/lib/followScroll";
import { pickFlowTarget, toggleFlowSelection } from "@/lib/flowTarget";
import type { StepInfo } from "@/lib/stepLog";
import { getBrowserStorage } from "@/lib/motion";
import { applySidebar, writeSidebarCollapsed } from "@/lib/sidebar";
import { formatWait, turnItemKey, type TurnCounts, type TurnItem } from "@/lib/turn";
import type { WatchdogNotice } from "@/lib/watchdogState";
import { Conversation, type ConversationNotice } from "./Conversation";
import { PanelLeftIcon } from "./icons";
import styles from "./Desk.module.css";
import { FlowMap } from "./FlowMap";
import { NewIssueForm, type NewIssueRepo } from "./NewIssueForm";
import { SideRepos, type TopBarRepo } from "./TopBar";
import { TurnList } from "./TurnList";
import { TurnRow } from "./TurnRow";
import { pickTurn } from "@/lib/turnList";

export type DeskScope =
  | { kind: "all"; repoCount: number }
  | { kind: "repo"; owner: string; repo: string; githubUrl: string | null };

export type DeskError = { repo: string; message: string };

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
};

export type DeskNav = {
  repos: TopBarRepo[];
  counts: TurnCounts;
  runningCounts: TurnCounts;
  /** リンクの頭（デモでは `/demo`） */
  basePath?: string;
  /** 左のバーのいちばん下：ログイン中のユーザー名とログアウト（デモでは無し） */
  login?: string;
  logout?: () => Promise<void>;
};

/** 左のバーを畳んだか：<html> の data-side が正（描く前のスクリプトが保存から付ける） */
function subscribeSidebar(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-side"] });
  return () => observer.disconnect();
}

function getSidebarSnapshot(): boolean {
  return document.documentElement.getAttribute("data-side") === "closed";
}

/** ページのいちばん下へ即座に移す */
function scrollToBottom(): void {
  window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" });
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
  addedNotices = [],
  nav,
  newIssueRepos,
  loadStepLog,
  hideUnknownModel = false,
}: Props) {
  // 左のバーを畳んだか。見た目は <html> の data-side（描く前のスクリプトが付ける）で決まり、ここは読み上げと inert 用
  const sideCollapsed = useSyncExternalStore(subscribeSidebar, getSidebarSnapshot, () => false);
  const toggleSide = useCallback(() => {
    const next = !getSidebarSnapshot();
    applySidebar(next, document.documentElement);
    writeSidebarCollapsed(getBrowserStorage(), next);
  }, []);

  const rowsRef = useRef<HTMLDivElement>(null);
  // 操作が通って片づけた1件。取り直しを待たずに次の1件に替え、件数を減らす（取り直しで消えたら自然に数えなくなる）
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(() => new Set());
  // 片づけた1件の中にフォーカスがあった（見出しへ移した）。次の1件が出たら、その最初のボタンへ移す
  const focusNext = useRef(false);
  const waiting = items.filter((item) => !leaving.has(turnItemKey(item)));
  // 一覧で選んだ1件（`owner/repo#番号`）。その画面にいる間だけ覚え、片づいたら並び順の先頭に戻る
  const [picked, setPicked] = useState<string | null>(null);
  const current = pickTurn(waiting, picked);
  const currentKey = current ? turnItemKey(current) : null;
  const others = waiting.filter((item) => turnItemKey(item) !== currentKey);
  const rest = others.length;
  // 開いたときの1件はフェードしない。替わった1件だけ短くフェードする
  const [firstKey] = useState(currentKey);

  const leave = useCallback((key: string, on: boolean) => {
    if (on && document.activeElement?.id === "turn-title") focusNext.current = true;
    setLeaving((prev) => {
      if (prev.has(key) === on) return prev;
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);

  // 一覧の行を選んだ：その行は大きい方に移るので、フォーカスも大きい1件の最初のボタンへ移す
  const pick = useCallback((key: string) => {
    focusNext.current = true;
    setPicked(key);
  }, []);

  useEffect(() => {
    if (!focusNext.current) return;
    focusNext.current = false;
    if (currentKey === null) return;
    const row = rowsRef.current?.querySelector(`[data-key="${CSS.escape(currentKey)}"]`);
    firstControl(row)?.focus();
  }, [currentKey]);

  // 中央は上が古く下が新しい。開いたとき・リポジトリを切り替えたときはいちばん下で始め、
  // 取り直しでは、いちばん下にいる間だけ追従する（さかのぼり中は動かさない）
  const scopeKey = scope.kind === "all" ? "all" : `${scope.owner}/${scope.repo}`;
  const followBottom = useRef(true);
  useEffect(() => {
    const update = () => {
      const root = document.documentElement;
      followBottom.current = isNearBottom(root.scrollHeight, window.scrollY, window.innerHeight);
    };
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);
  useLayoutEffect(() => {
    const place = () => {
      const root = document.documentElement;
      const answer = rowsRef.current?.querySelector<HTMLElement>("[data-answer]") ?? null;
      const position = openPosition(root.scrollHeight, window.innerHeight, answer !== null);
      if (position === "answer" && answer) {
        // 上端の帯の下（scroll-padding-top）に、その1件の上端（種類の札と題名）を置く
        answer.scrollIntoView({ block: "start", behavior: "instant" });
      } else if (position === "bottom") {
        scrollToBottom();
      } else {
        window.scrollTo({ top: 0, behavior: "instant" });
      }
      followBottom.current = position === "bottom" || position === "top";
    };
    place();
    // 答える欄がある1件は、最初の選択肢（キー操作の決まりで Tab が止まる物）にフォーカスを置く
    rowsRef.current
      ?.querySelector<HTMLElement>('[data-answer] [role="radio"][tabindex="0"]')
      ?.focus({ preventScroll: true });
    // ページを移ったあとの、Next の「上へ戻す」より後にもう一度送る
    const frame = requestAnimationFrame(place);
    return () => cancelAnimationFrame(frame);
  }, [scopeKey]);
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
      text: `${scope.kind === "all" ? `${notice.repo}　` : ""}見張り役が ${notice.hours} 時間動いていません。Actions が止まっていないか確認してください`,
    })),
    ...errors.map((error) => ({ key: `error:${error.repo}`, tone: "fail" as const, text: `${error.repo}：${error.message}` })),
  ];

  const showRepo = scope.kind === "all" && scope.repoCount > 1;
  // 「いまの様子」で選んだ行（`owner/repo#番号`）。同じ行をもう一度選ぶと外す。選んでいなければ今まで通りの1件を描く
  const [selected, setSelected] = useState<string | null>(null);
  const select = useCallback((key: string) => setSelected((prev) => toggleFlowSelection(prev, key)), []);
  const pickedTarget = pickFlowTarget(current, messages, showRepo, selected);
  // 選んだ行がもう無い（取り直しで消えた）ときは、選んでいない扱い
  const selectedKey = selected !== null && messages.some((message) => message.key === selected) ? selected : null;
  const targetKey = pickedTarget ? `${pickedTarget.owner}/${pickedTarget.repo}#${pickedTarget.number}` : null;
  // 進捗ログ（モデル名と所要時間）。取れるまで・取れないときは「不明」のまま。データを取り直したら読み直す
  const [stepLog, setStepLog] = useState<{ key: string; infos: StepInfo[] } | null>(null);
  useEffect(() => {
    if (!loadStepLog || !pickedTarget || targetKey === null) return;
    let cancelled = false;
    loadStepLog(pickedTarget.owner, pickedTarget.repo, pickedTarget.number)
      .then((infos) => {
        if (!cancelled) setStepLog({ key: targetKey, infos });
      })
      .catch(() => {
        if (!cancelled) setStepLog(null);
      });
    return () => {
      cancelled = true;
    };
    // pickedTarget は毎回作り直されるので、中身を表す targetKey と now で見る
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadStepLog, targetKey, now]);
  const loadedTarget =
    pickedTarget && stepLog?.key === targetKey
      ? { ...pickedTarget, flow: applyStepLog(pickedTarget.flow, stepLog.infos), stepLog: stepLog.infos }
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
      added={addedNotices}
      selected={selectedKey}
      onSelect={select}
      loadStepLog={loadStepLog}
      hideUnknownModel={hideUnknownModel}
      repoOrder={nav.repos.map((r) => `${r.owner}/${r.repo}`)}
    />
  );

  const column = (
    <main className={styles.desk} id="main">
      {conversation}
      <section
        className={styles.turn}
        data-empty={current ? undefined : ""}
        aria-labelledby="turn-title"
        data-skip-target=""
      >
        <div className={styles.head}>
          <h1 className={styles.h1} id="turn-title" tabIndex={-1}>
            {current ? "あなたの番" : "今はAIの番です"}
          </h1>
          {rest > 0 && (
            <p className={styles.rest}>
              ほかに <b className="num">{rest}</b>件
            </p>
          )}
        </div>
        {!current && <p className={styles.calm}>あなたが答えることはありません。上で、いまの様子を読めます</p>}
        <TurnList items={others} now={at} showRepo={showRepo} onPick={pick} />

        <div ref={rowsRef}>
          {items.map((item) => {
            const key = turnItemKey(item);
            // 出すのは今の1件と、片づけて隠している1件（取り直しで消えるまで、戻せるように残す）だけ
            if (key !== currentKey && !leaving.has(key)) return null;
            return (
              <TurnRow
                key={key}
                item={item}
                wait={formatWait(item.waitingSince, at)}
                fresh={key === currentKey && key !== firstKey}
                onLeave={leave}
              />
            );
          })}
        </div>
      </section>
    </main>
  );

  // PC（幅900px以上）は3ペイン：左に一覧、中央に列と下の入力欄、右に進捗図の列。スマホでは列だけ（docs/design.md の「PCの3ペイン」）
  return (
    <div className={styles.panes} data-panes="">
      <button
        type="button"
        className={styles.sideToggle}
        onClick={toggleSide}
        aria-expanded={!sideCollapsed}
        aria-controls="side-repos"
        aria-label={sideCollapsed ? "リポジトリの一覧を開く" : "リポジトリの一覧を畳む"}
        title={sideCollapsed ? "リポジトリの一覧を開く" : "リポジトリの一覧を畳む"}
      >
        <PanelLeftIcon />
      </button>
      <div className={styles.side} id="side-repos" inert={sideCollapsed}>
        <SideRepos {...nav} />
      </div>
      <div className={styles.center}>
        {column}
        <div className={styles.composer}>
          <NewIssueForm
            variant="bar"
            newServiceHref={`${nav.basePath ?? ""}/new/service`}
            repos={newIssueRepos}
            initialRepo={scope.kind === "repo" ? `${scope.owner}/${scope.repo}` : undefined}
          />
        </div>
      </div>
      <div className={styles.flow}>
        <FlowMap target={flowTarget} />
      </div>
    </div>
  );
}
