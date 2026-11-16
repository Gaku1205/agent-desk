"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { addedNoticeText, type AddedNotice } from "@/lib/autoAdd";
import type { ChatMessage } from "@/lib/conversation";
import { applyStepLog } from "@/lib/flow";
import { pickFlowTarget, toggleFlowSelection } from "@/lib/flowTarget";
import type { StepInfo } from "@/lib/stepLog";
import { getBrowserStorage } from "@/lib/motion";
import { applySidebar, writeSidebarCollapsed } from "@/lib/sidebar";
import { formatWait, turnItemKey, type TurnCounts, type TurnItem } from "@/lib/turn";
import type { WatchdogNotice } from "@/lib/watchdogState";
import Link from "next/link";
import { Conversation, type ConversationNotice } from "./Conversation";
import { PanelLeftIcon, PlusIcon } from "./icons";
import styles from "./Desk.module.css";
import { FlowMap } from "./FlowMap";
import { NewIssueForm, type NewIssueRepo } from "./NewIssueForm";
import { SideRepos, type TopBarRepo } from "./TopBar";
import { TurnRow } from "./TurnRow";

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
  const current = waiting[0] ?? null;
  const currentKey = current ? turnItemKey(current) : null;
  const rest = Math.max(0, waiting.length - 1);
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

  useEffect(() => {
    if (!focusNext.current) return;
    focusNext.current = false;
    if (currentKey === null) return;
    const row = rowsRef.current?.querySelector(`[data-key="${CSS.escape(currentKey)}"]`);
    firstControl(row)?.focus();
  }, [currentKey]);

  const at = new Date(now);
  const conversationNotices: ConversationNotice[] = [
    ...notices.map((notice) => ({
      key: `watchdog:${notice.owner}/${notice.repo}`,
      tone: "warn" as const,
      text: `${scope.kind === "all" ? `${notice.repo}　` : ""}見張り役が ${notice.hours} 時間動いていません。Actions が止まっていないか確認してください`,
    })),
    ...errors.map((error) => ({ key: `error:${error.repo}`, tone: "fail" as const, text: `${error.repo}：${error.message}` })),
    ...addedNotices.map((notice) => ({
      key: `added:${notice.owner}/${notice.repo}`,
      tone: "info" as const,
      text: addedNoticeText(notice),
      at: notice.at,
    })),
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
  const flowTarget =
    pickedTarget && stepLog?.key === targetKey
      ? { ...pickedTarget, flow: applyStepLog(pickedTarget.flow, stepLog.infos), stepLog: stepLog.infos }
      : pickedTarget;

  const column = (
    <main className={styles.desk} id="main">
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
          {/* スマホ：ホームの分かりやすい所。PCは帯に出す */}
          <Link href={`${nav.basePath ?? ""}/new/service`} className={styles.newService}>
            <PlusIcon />
            新しいサービスを作る
          </Link>
        </div>
        {!current && <p className={styles.calm}>あなたが答えることはありません。下で、いまの様子を読めます</p>}
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
        {current && (
          <a className={styles.down} href="#now">
            いまの様子 ↓
          </a>
        )}
      </section>
      <Conversation
        messages={messages}
        now={now}
        showRepo={showRepo}
        repo={scope.kind === "repo" ? { name: scope.repo, githubUrl: scope.githubUrl } : null}
        notices={conversationNotices}
        selected={selectedKey}
        onSelect={select}
        loadStepLog={loadStepLog}
      />
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
