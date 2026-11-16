"use client";

import { useState } from "react";
import type { ChatMessage } from "@/lib/conversation";
import { formatWait } from "@/lib/turn";
import { TriangleDownIcon } from "./icons";
import { LampMark } from "./LampMark";
import { SmartLink } from "./SmartLink";
import styles from "./Conversation.module.css";

export type ConversationNotice = { key: string; text: string; tone: "warn" | "fail" };

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
};

/** 「いまの様子」：進行中の作業を、会話のメッセージのように縦に並べる（docs/design.md の「いまの様子」） */
export function Conversation({ messages, now, showRepo, repo, notices }: Props) {
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
    return (
      <article key={message.key} className={styles.msg} data-key={message.key} data-fresh={fresh(message.key) ? "" : undefined}>
        <p className={styles.meta}>
          <LampMark lamp={message.lamp} />
          <span className={styles.who} data-fail={message.failed ? "" : undefined}>
            {message.speaker}
          </span>
          <span className={styles.sep} aria-hidden="true">
            ·
          </span>
          <span className="num">{label}</span>
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
