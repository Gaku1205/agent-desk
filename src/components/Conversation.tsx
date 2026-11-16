"use client";

import { useState } from "react";
import type { ChatMessage } from "@/lib/conversation";
import { formatWait } from "@/lib/turn";
import { TriangleDownIcon } from "./icons";
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
};

/** 行の中の、リンク・ボタン・入力（押したら、それぞれの動きだけにする） */
function isControl(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest("a, button, input, textarea, select, summary") !== null;
}

/** 「いまの様子」：進行中の作業を、会話のメッセージのように縦に並べる（docs/design.md の「いまの様子」） */
export function Conversation({ messages, now, showRepo, repo, notices, selected = null, onSelect }: Props) {
  // 公開済みを開いているか。その画面にいる間だけ覚える
  const [deployedOpen, setDeployedOpen] = useState(false);
  // 前の描画のメッセージ（新しく入った物を見分ける）
  const [seen, setSeen] = useState<{ messages: ChatMessage[]; keys: Set<string> | null }>({ messages, keys: null });
  if (seen.messages !== messages) setSeen({ messages, keys: new Set(seen.messages.map((m) => m.key)) });

  const active = messages.filter((m) => !m.deployed);
  const deployed = messages.filter((m) => m.deployed);
  const at = new Date(now);
  const fresh = (key: string) => seen.keys !== null && seen.messages === messages && !seen.keys.has(key);

  function renderMessage(message: ChatMessage) {
    const label = showRepo ? `${message.repo}#${message.number}` : `#${message.number}`;
    const isSelected = selected === message.key;
    return (
      <article
        key={message.key}
        className={styles.msg}
        data-lamp={message.lamp.kind}
        title={lampLabel(message.lamp) ?? undefined}
        data-key={message.key}
        data-fresh={fresh(message.key) ? "" : undefined}
        data-selectable={onSelect ? "" : undefined}
        data-selected={isSelected ? "" : undefined}
        onClick={
          onSelect
            ? (event) => {
                // 行のどこを押しても選べる（リンク・ボタンと、文字を選んでいるときは除く）
                // スマホは進捗図を出さないので選ばない
                if (isControl(event.target) || window.getSelection()?.toString()) return;
                if (!window.matchMedia("(min-width: 900px)").matches) return;
                onSelect(message.key);
              }
            : undefined
        }
      >
        <p className={styles.meta}>
          <LampLabel lamp={message.lamp} />
          <span className={styles.who} data-fail={message.failed ? "" : undefined}>
            {message.speaker}
          </span>
          <span className={styles.sep} aria-hidden="true">
            ·
          </span>
          {onSelect ? (
            <button
              type="button"
              className={`${styles.pick} num`}
              aria-pressed={isSelected}
              aria-label={`${label} の進捗図を見る`}
              onClick={() => onSelect(message.key)}
            >
              {label}
            </button>
          ) : (
            <span className="num">{label}</span>
          )}
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
        <p className={styles.text}>{message.text}</p>
        <p className={styles.title}>
          <SmartLink href={message.url}>{message.title}</SmartLink>
        </p>
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
        {message.steps.length > 0 && (
          <ul className={styles.steps} aria-label="出来事">
            {message.steps.map((step) => (
              <li key={step.id} data-tone={step.tone}>
                <time className="num" dateTime={step.at}>
                  {step.time}
                </time>
                <span>{step.short}</span>
              </li>
            ))}
          </ul>
        )}
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
