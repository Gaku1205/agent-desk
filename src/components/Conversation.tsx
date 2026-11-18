"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { AddedNotice } from "@/lib/autoAdd";
import type { AiActivity } from "@/lib/aiActivity";
import { queueAfterNumber, type ChatMessage } from "@/lib/conversation";
import { splitQueue } from "@/lib/queueGroup";
import { applyStepLog, hideUnknownModels } from "@/lib/flow";
import type { StepInfo } from "@/lib/stepLog";
import { formatWait } from "@/lib/turn";
import { FlowMap } from "./FlowMap";
import { CheckIcon, CrossIcon, SpinnerIcon } from "./icons";
import { lampLabel } from "@/lib/lamp";
import {
  addedPastText,
  buildPastItems,
  clockTime,
  groupByDay,
  PAST_STEP,
  type PastItem,
  visibleCount,
  visiblePast,
} from "@/lib/pastLog";
import { LampLabel, LampWait } from "./LampMark";
import { QueueIcon } from "./QueueIcon";
import { SmartLink } from "./SmartLink";
import styles from "./Conversation.module.css";

export type ConversationNotice = {
  key: string;
  text: string;
  /** warn＝見張り役、fail＝取れなかったリポジトリ */
  tone: "warn" | "fail";
};

type Props = {
  messages: ChatMessage[];
  /** 「今」（ISO文字列） */
  now: string;
  /** 番号の前にリポジトリ名を付けるか（2つ以上のリポジトリを出しているとき） */
  showRepo: boolean;
  /** リポジトリのページ：見出しの横に出すリポジトリ名と GitHub のリンク */
  repo: { name: string; githubUrl: string | null } | null;
  /** 「いまの様子」の上のお知らせ（見張り役・取れなかったリポジトリ） */
  notices: ConversationNotice[];
  /** 自動で監視に足したリポジトリ。公開済みと同じ過去の欄に、日ごとに混ぜる */
  added?: AddedNotice[];
  /** PCの進捗図に描くため選んでいる行（`owner/repo#番号`）。選んでいなければ null */
  selected?: string | null;
  /** 行を選んだ（同じ行なら外す。決めるのは Desk） */
  onSelect?: (key: string) => void;
  /** スマホで開いた行の進捗図の「モデル名と所要時間」を読む（デモは渡さない） */
  loadStepLog?: LoadStepLog;
  /** デモ：記録が無い工程の「不明」を出さない */
  hideUnknownModel?: boolean;
  /** リポジトリの並び（`owner/repo`。左の一覧と同じ順）。順番待ちを始まる順に並べるのに使う */
  repoOrder?: string[];
};

type LoadStepLog = (owner: string, repo: string, number: number) => Promise<StepInfo[]>;

/** スマホで開いた行の進捗図。開いている間だけ描き、進捗ログ（モデル名と所要時間）もこのときに読む */
function OpenFlow({
  message,
  label,
  now,
  loadStepLog,
  hideUnknownModel = false,
}: {
  message: ChatMessage;
  label: string;
  now: string;
  loadStepLog?: LoadStepLog;
  hideUnknownModel?: boolean;
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
        // 読めなかったときも、読み込み中は外す（記録が無い扱い）
        if (!cancelled) setInfos([]);
      });
    return () => {
      cancelled = true;
    };
  }, [loadStepLog, message.owner, message.repo, message.number, now]);
  // 読み込み中（帯）にするのは、進捗ログを読む（loadStepLog あり）で、まだ読み終えていないときだけ
  const logged = infos ? applyStepLog(message.flow, infos) : loadStepLog ? message.flow : applyStepLog(message.flow, []);
  const flow = hideUnknownModel ? hideUnknownModels(logged) : logged;
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
 * どちらでもない物（順番待ち・公開済みなど）は null（印なし。並びは同じ）
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
  added = [],
  selected = null,
  onSelect,
  loadStepLog,
  hideUnknownModel,
  repoOrder,
}: Props) {
  // 過去の欄に、最初の5件のほかに読み足した件数。その画面にいる間だけ覚える
  const [loaded, setLoaded] = useState(0);
  // 読み足す直前のページの高さ（足した分だけ位置を戻すため）
  const heightBefore = useRef<number | null>(null);
  // スマホで進捗図を開いている行（`owner/repo#番号`）。その画面にいる間だけ覚える
  const [openFlows, setOpenFlows] = useState<ReadonlySet<string>>(() => new Set());
  const toggleOpen = (key: string) =>
    setOpenFlows((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  // 順番待ちのまとまりを開いているか。その画面にいる間だけ覚える
  const [queueOpen, setQueueOpen] = useState(false);
  // 理由を開いている行。その画面にいる間だけ覚える
  const [openNotes, setOpenNotes] = useState<ReadonlySet<string>>(() => new Set());
  const toggleNote = (key: string) =>
    setOpenNotes((prev) => {
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
    if ([...openNotes].some((k) => !alive.has(k))) {
      setOpenNotes(new Set([...openNotes].filter((k) => alive.has(k))));
    }
  }

  const active = messages.filter((m) => !m.deployed);
  const { queue, rest } = splitQueue(active, repoOrder);
  const at = new Date(now);
  const pastAll = buildPastItems(messages, added);
  const shown = visibleCount(pastAll.length, loaded);
  const days = groupByDay(visiblePast(pastAll, shown), at);
  const hasMore = shown < pastAll.length;

  const loadMore = useCallback(() => {
    heightBefore.current = document.documentElement.scrollHeight;
    setLoaded((n) => n + PAST_STEP);
  }, []);
  // 読み足したとき、見ていた位置が動かないよう、足した分の高さだけ位置を戻す
  useLayoutEffect(() => {
    if (heightBefore.current === null) return;
    const diff = document.documentElement.scrollHeight - heightBefore.current;
    heightBefore.current = null;
    if (diff > 0) window.scrollBy({ top: diff, behavior: "instant" });
  }, [shown]);
  // 上の端までスクロールしたら読み足す（上へ動いて端に着いたときだけ。開いた直後には読み足さない）
  const canLoad = useRef(hasMore);
  useEffect(() => {
    canLoad.current = hasMore;
  }, [hasMore]);
  useEffect(() => {
    let last = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      if (y <= 0 && last > 0 && canLoad.current) loadMore();
      last = y;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [loadMore]);
  const fresh = (key: string) => seen.keys !== null && seen.messages === messages && !seen.keys.has(key);

  /** 理由（あれば）：最初は折りたたみ、押すと開く */
  function renderNote(message: ChatMessage) {
    if (!(message.note || message.logUrl || message.links.length > 0)) return null;
    const isNoteOpen = openNotes.has(message.key);
    const noteId = `note-${message.key.replace(/[^A-Za-z0-9_-]/g, "-")}`;
    return (
      <div className={styles.noteWrap}>
        <button
          type="button"
          className={styles.noteToggle}
          aria-expanded={isNoteOpen}
          aria-controls={noteId}
          onClick={() => toggleNote(message.key)}
        >
          {isNoteOpen ? "理由を閉じる" : "理由を見る"}
        </button>
        {isNoteOpen && (
          <p className={styles.note} id={noteId}>
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
      </div>
    );
  }

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
        {/* どの段も：題名が上、作業内容が下（動いている・止まった物だけ左に回る印か×） */}
        <p className={`${styles.title} ${styles.titleTop}`}>
          <SmartLink href={message.url}>{message.title}</SmartLink>
        </p>
        {mark === null ? (
          <p className={styles.text}>{message.text}</p>
        ) : (
          <>
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
        {renderNote(message)}
        {isOpen && (
          <OpenFlow
            message={message}
            label={label}
            now={now}
            loadStepLog={loadStepLog}
            hideUnknownModel={hideUnknownModel}
          />
        )}
      </article>
    );
  }

  /** 順番待ちのまとまり：最初は畳んで1行、押すと始まる順に1行ずつ（docs/design.md の「順番待ちのまとまり」） */
  function renderQueue() {
    const next = queue[0];
    const nextLabel = showRepo ? `${next.repo}#${next.number}` : `#${next.number}`;
    return (
      <div className={styles.queue}>
        <button
          type="button"
          className={styles.queueToggle}
          aria-expanded={queueOpen}
          aria-controls="queue-list"
          onClick={() => setQueueOpen((open) => !open)}
        >
          <span className={styles.queueIcon}>
            <QueueIcon size={12} />
            <span>
              順番待ち <span className="num">{queue.length}</span>件（次：<span className="num">{nextLabel}</span>）
            </span>
          </span>
          <span aria-hidden="true"> {queueOpen ? "▴" : "▾"}</span>
        </button>
        {queueOpen && (
          <ul className={styles.queueList} id="queue-list">
            {queue.map((message) => {
              const label = showRepo ? `${message.repo}#${message.number}` : `#${message.number}`;
              const after = queueAfterNumber(message.note);
              const isSelected = selected === message.key;
              const isOpen = openFlows.has(message.key);
              return (
                <li key={message.key} className={styles.queueRow} data-key={message.key}>
                  <p className={styles.meta}>
                    <span className={styles.queueIcon}>
                      <QueueIcon size={12} />
                      <button
                        type="button"
                        className={`${styles.pick} num`}
                        aria-pressed={isSelected || isOpen}
                        aria-label={`${label} の進捗図を見る`}
                        onClick={() => {
                          if (isDesktop()) onSelect?.(message.key);
                          else toggleOpen(message.key);
                        }}
                      >
                        {label}
                      </button>
                    </span>
                    <span className={styles.sep} aria-hidden="true">
                      ·
                    </span>
                    <span>{message.repo}</span>
                    {after !== null && (
                      <>
                        <span className={styles.sep} aria-hidden="true">
                          ·
                        </span>
                        <span className="num">#{after} の後</span>
                      </>
                    )}
                  </p>
                  <p className={`${styles.title} ${styles.titleTop}`}>
                    <SmartLink href={message.url}>{message.title}</SmartLink>
                  </p>
                  {renderNote(message)}
                  {isOpen && (
                    <OpenFlow
                      message={message}
                      label={label}
                      now={now}
                      loadStepLog={loadStepLog}
                      hideUnknownModel={hideUnknownModel}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    );
  }

  /** 過去の欄の1行：しるし・題名・リポジトリ#番号・時刻（押すと進捗図。スマホは行の下に開く） */
  function renderPast(item: PastItem) {
    if (item.kind === "added") {
      return (
        <li key={item.key} className={styles.pastRow}>
          <span className={styles.pastLine}>
            <span className={styles.pastTitle}>{addedPastText(item.repo)}</span>
            <time className={`${styles.pastTime} num`} dateTime={item.at}>
              {clockTime(item.at)}
            </time>
          </span>
        </li>
      );
    }
    const { message } = item;
    const label = showRepo ? `${message.repo}#${message.number}` : `#${message.number}`;
    const isSelected = selected === message.key;
    const isOpen = openFlows.has(message.key);
    return (
      <li
        key={item.key}
        className={styles.pastRow}
        data-key={message.key}
        data-selected={isSelected ? "" : undefined}
        data-open={isOpen ? "" : undefined}
      >
        <button
          type="button"
          className={`${styles.pastLine} ${styles.pastButton}`}
          aria-pressed={isSelected || isOpen}
          aria-label={`${message.title}（${label}）の進捗図を見る`}
          onClick={() => {
            if (isDesktop()) onSelect?.(message.key);
            else toggleOpen(message.key);
          }}
        >
          <span className={styles.pastMark} aria-hidden="true">
            <CheckIcon />
          </span>
          <span className={styles.pastTitle}>{message.title}</span>
          <span className={`${styles.pastRef} num`}>{label}</span>
          <time className={`${styles.pastTime} num`} dateTime={item.at}>
            {clockTime(item.at)}
          </time>
        </button>
        {isOpen && (
          <OpenFlow
            message={message}
            label={label}
            now={now}
            loadStepLog={loadStepLog}
            hideUnknownModel={hideUnknownModel}
          />
        )}
      </li>
    );
  }

  return (
    <section className={styles.now} id="now" aria-labelledby="now-title">
      {pastAll.length > 0 && (
        <div className={styles.past} aria-label="古い会話" role="region">
          {hasMore ? (
            <button type="button" className={styles.pastMore} onClick={loadMore}>
              さらに前を読む
            </button>
          ) : (
            <p className={styles.pastEnd}>ここまで</p>
          )}
          {days.map((day) => (
            <div key={day.key} className={styles.day}>
              <h3 className={styles.dayHead}>{day.label}</h3>
              <ul className={styles.pastList}>{day.items.map(renderPast)}</ul>
            </div>
          ))}
        </div>
      )}
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
            </li>
          ))}
        </ul>
      )}
      {active.length === 0 ? (
        <p className={styles.empty}>動いている作業はありません</p>
      ) : (
        <>
          {queue.length > 0 && renderQueue()}
          {rest.length > 0 && <div className={styles.list}>{rest.map(renderMessage)}</div>}
        </>
      )}
    </section>
  );
}
