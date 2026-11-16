"use client";

import { useEffect, useState } from "react";
import type { AiActivity } from "@/lib/aiActivity";
import type { ChatMessage } from "@/lib/conversation";
import { applyStepLog } from "@/lib/flow";
import type { StepInfo } from "@/lib/stepLog";
import { formatWait } from "@/lib/turn";
import { FlowMap } from "./FlowMap";
import { CrossIcon, SpinnerIcon, TriangleDownIcon } from "./icons";
import { lampLabel } from "@/lib/lamp";
import { LampLabel, LampWait } from "./LampMark";
import { SmartLink } from "./SmartLink";
import styles from "./Conversation.module.css";

export type ConversationNotice = {
  key: string;
  text: string;
  /** warn＝見張り役、fail＝取れなかったリポジトリ、info＝自動で監視に足した */
  tone: "warn" | "fail" | "info";
  /** 出来事の時刻（ISO文字列）。あれば文の後ろに `· 12分前` */
  at?: string;
};

type Props = {
  messages: ChatMessage[];
  /** 「今」（ISO文字列） */
  now: string;
  /** 番号の前にリポジトリ名を付けるか（2つ以上のリポジトリを出しているとき） */
  showRepo: boolean;
  /** リポジトリのページ：見出しの横に出すリポジトリ名と GitHub のリンク */
  repo: { name: string; githubUrl: string | null } | null;
  /** いちばん上のお知らせ（見張り役・取れなかったリポジトリ） */
  notices: ConversationNotice[];
  /** PCの進捗図に描くため選んでいる行（`owner/repo#番号`）。選んでいなければ null */
  selected?: string | null;
  /** 行を選んだ（同じ行なら外す。決めるのは Desk） */
  onSelect?: (key: string) => void;
  /** スマホで開いた行の進捗図の「モデル名と所要時間」を読む（デモは渡さない） */
  loadStepLog?: LoadStepLog;
};

type LoadStepLog = (owner: string, repo: string, number: number) => Promise<StepInfo[]>;

/** スマホで開いた行の進捗図。開いている間だけ描き、進捗ログ（モデル名と所要時間）もこのときに読む */
function OpenFlow({
  message,
  label,
  now,
  loadStepLog,
}: {
  message: ChatMessage;
  label: string;
  now: string;
  loadStepLog?: LoadStepLog;
}) {
  const [infos, setInfos] = useState<StepInfo[] | null>(null);
  useEffect(() => {
    if (!loadStepLog) return;
    let cancelled = false;
    loadStepLog(message.owner, message.repo, message.number)
      .then((result) => {
        if (!cancelled) setInfos(result);
      })
      .catch(() => {
        if (!cancelled) setInfos(null);
      });
    return () => {
      cancelled = true;
    };
  }, [loadStepLog, message.owner, message.repo, message.number, now]);
  const flow = infos ? applyStepLog(message.flow, infos) : message.flow;
  return (
    <FlowMap
      inline
      target={{
        owner: message.owner,
        repo: message.repo,
        number: message.number,
        label,
        title: message.title,
        url: message.url,
        flow,
        extra: message.flowExtra,
        stepLog: infos,
      }}
    />
  );
}

/**
 * 作業の様子の左の印：動いている（ランプが動作中）＝回る印、止まった・失敗した（人間の手が必要・CI失敗）＝×。
 * どちらでもない物（順番待ち・公開済みなど）は null（今までの並びのまま）
 */
function statusMark(message: ChatMessage): "running" | "failed" | null {
  if (message.lamp.kind === "running") return "running";
  if (message.lamp.kind === "needsHuman" || message.failed) return "failed";
  return null;
}

/** AIが今していること：いまのやること1行・終わった数／全部の数・GitHubで見る（docs/design.md の「いまの様子」） */
function ActivityLine({ activity }: { activity: AiActivity }) {
  const text = activity.kind === "todo" ? activity.current : activity.name;
  return (
    <p className={styles.activity}>
      {text !== null && <span className={styles.activityText}>{text}</span>}
      {activity.kind === "todo" && activity.total > 0 && (
        <span className={`${styles.activityCount} num`}>
          {activity.done}/{activity.total}
        </span>
      )}
      {activity.url && (
        <SmartLink className={styles.link} href={activity.url}>
          GitHubで見る ↗
        </SmartLink>
      )}
    </p>
  );
}

/** 行の中の、リンク・ボタン・入力（押したら、それぞれの動きだけにする） */
function isControl(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest("a, button, input, textarea, select, summary") !== null;
}

/** 「いまの様子」：進行中の作業を、会話のメッセージのように縦に並べる（docs/design.md の「いまの様子」） */
export function Conversation({
  messages,
  now,
  showRepo,
  repo,
  notices,
  selected = null,
  onSelect,
  loadStepLog,
}: Props) {
  // 公開済みを開いているか。その画面にいる間だけ覚える
  const [deployedOpen, setDeployedOpen] = useState(false);
  // スマホで進捗図を開いている行（`owner/repo#番号`）。その画面にいる間だけ覚える
  const [openFlows, setOpenFlows] = useState<ReadonlySet<string>>(() => new Set());
  const toggleOpen = (key: string) =>
    setOpenFlows((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  const isDesktop = () => window.matchMedia("(min-width: 900px)").matches;
  // 前の描画のメッセージ（新しく入った物を見分ける）
  const [seen, setSeen] = useState<{ messages: ChatMessage[]; keys: Set<string> | null }>({ messages, keys: null });
  if (seen.messages !== messages) {
    setSeen({ messages, keys: new Set(seen.messages.map((m) => m.key)) });
    // 取り直しで消えた行の「開いた状態」は捨てる
    const alive = new Set(messages.map((m) => m.key));
    if ([...openFlows].some((k) => !alive.has(k))) {
      setOpenFlows(new Set([...openFlows].filter((k) => alive.has(k))));
    }
  }

  const active = messages.filter((m) => !m.deployed);
  const deployed = messages.filter((m) => m.deployed);
  const at = new Date(now);
  const fresh = (key: string) => seen.keys !== null && seen.messages === messages && !seen.keys.has(key);

  function renderMessage(message: ChatMessage) {
    const label = showRepo ? `${message.repo}#${message.number}` : `#${message.number}`;
    const isSelected = selected === message.key;
    const isOpen = openFlows.has(message.key);
    const mark = statusMark(message);
    // PC：右の列の図の対象を選ぶ。スマホ：その行の下の図を開閉する
    const activate = () => {
      if (isDesktop()) onSelect?.(message.key);
      else toggleOpen(message.key);
    };
    return (
      <article
        key={message.key}
        className={styles.msg}
        data-lamp={message.lamp.kind}
        title={lampLabel(message.lamp) ?? undefined}
        data-key={message.key}
        data-fresh={fresh(message.key) ? "" : undefined}
        data-selectable=""
        data-selected={isSelected ? "" : undefined}
        data-open={isOpen ? "" : undefined}
        onClick={(event) => {
          // 行のどこを押しても使える（リンク・ボタンと、文字を選んでいるときは除く）
          if (isControl(event.target) || window.getSelection()?.toString()) return;
          // 開いた図の中を押しても閉じない（図を横にスクロールするため）
          if (event.target instanceof Element && event.target.closest('[role="region"]')) return;
          activate();
        }}
      >
        <p className={styles.meta}>
          <LampLabel lamp={message.lamp} />
          <span className={styles.who} data-fail={message.failed ? "" : undefined}>
            {message.speaker}
          </span>
          <span className={styles.sep} aria-hidden="true">
            ·
          </span>
          <button
            type="button"
            className={`${styles.pick} num`}
            aria-pressed={isSelected || isOpen}
            aria-label={`${label} の進捗図を見る`}
            onClick={activate}
          >
            {label}
          </button>
          {message.latestAt && (
            <>
              <span className={styles.sep} aria-hidden="true">
                ·
              </span>
              <time className="num" dateTime={message.latestAt}>
                {formatWait(message.latestAt, at)}前
              </time>
            </>
          )}
          <LampWait lamp={message.lamp} />
        </p>
        {mark === null ? (
          <>
            <p className={styles.text}>{message.text}</p>
            <p className={styles.title}>
              <SmartLink href={message.url}>{message.title}</SmartLink>
            </p>
          </>
        ) : (
          <>
            {/* 動いている・止まった物：題名が上、作業の様子が下（左に回る印か×） */}
            <p className={`${styles.title} ${styles.titleTop}`}>
              <SmartLink href={message.url}>{message.title}</SmartLink>
            </p>
            <p className={`${styles.text} ${styles.status}`}>
              <span className={styles.mark} data-state={mark} aria-hidden="true">
                {mark === "running" ? (
                  <span className={styles.spin}>
                    <SpinnerIcon />
                  </span>
                ) : (
                  <CrossIcon />
                )}
              </span>
              <span>{message.text}</span>
            </p>
            {message.activity && <ActivityLine activity={message.activity} />}
          </>
        )}
        {(message.note || message.logUrl || message.links.length > 0) && (
          <p className={styles.note}>
            {message.note && <span>{message.note}</span>}
            {message.logUrl && (
              <a className={styles.link} href={message.logUrl} target="_blank" rel="noreferrer">
                ログを開く ↗
              </a>
            )}
            {message.links.map((link) => (
              <a key={link.url} className={styles.link} href={link.url} target="_blank" rel="noreferrer">
                {link.label}
              </a>
            ))}
          </p>
        )}
        {isOpen && <OpenFlow message={message} label={label} now={now} loadStepLog={loadStepLog} />}
      </article>
    );
  }

  return (
    <section className={styles.now} id="now" aria-labelledby="now-title">
      <div className={styles.head}>
        <h2 className={styles.h2} id="now-title">
          いまの様子
        </h2>
        <span className={`${styles.count} num`}>{active.length}件</span>
        {repo && (
          <span className={styles.scope}>
            <span>{repo.name} だけ</span>
            {repo.githubUrl && (
              <a className={styles.scopeLink} href={repo.githubUrl} target="_blank" rel="noreferrer">
                GitHubで開く ↗
              </a>
            )}
          </span>
        )}
      </div>
      {notices.length > 0 && (
        <ul className={styles.notices} role="status">
          {notices.map((notice) => (
            <li key={notice.key} data-tone={notice.tone}>
              {notice.text}
              {notice.at && (
                <>
                  <span className={styles.sep} aria-hidden="true">
                    {" · "}
                  </span>
                  <time className={`${styles.noticeTime} num`} dateTime={notice.at}>
                    {formatWait(notice.at, at)}前
                  </time>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {active.length === 0 ? (
        <p className={styles.empty}>動いている作業はありません</p>
      ) : (
        <div className={styles.list}>{active.map(renderMessage)}</div>
      )}
      {deployed.length > 0 && (
        <>
          <button
            type="button"
            className={styles.more}
            aria-expanded={deployedOpen}
            onClick={() => setDeployedOpen((open) => !open)}
          >
            {deployedOpen ? "公開済みをたたむ" : `公開済み ${deployed.length}件`}
            <span className={styles.caret}>
              <TriangleDownIcon />
            </span>
          </button>
          {deployedOpen && <div className={`${styles.list} ${styles.opened}`}>{deployed.map(renderMessage)}</div>}
        </>
      )}
    </section>
  );
}
