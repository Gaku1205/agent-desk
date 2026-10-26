"use client";

import Link from "next/link";
import { DEMO_APP_REPO_URL } from "@/lib/demo/data";
import { PLAY_BUTTON_LABEL } from "@/lib/demo/playback";
import styles from "./DemoBanner.module.css";
import { useDemoState } from "./DemoContext";

/** デモの帯（画面のいちばん上）。スマホでは文言を短くし、右は「再生 ▶」だけ（ほかはメニューの中） */
export function DemoBanner() {
  const { playState, play } = useDemoState();

  return (
    <div className={styles.banner}>
      <p className={styles.text}>
        <span className={styles.dot} aria-hidden="true" />
        <span className={styles.long}>
          デモ：サンプルのデータです。ボタンを押しても実際には何も起きません
        </span>
        <span className={styles.short}>デモ（サンプルのデータ）</span>
      </p>
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.action}
          onClick={play}
          disabled={playState === "playing"}
          aria-live="polite"
        >
          {PLAY_BUTTON_LABEL[playState]}
        </button>
        <a
          className={`${styles.action} ${styles.extra}`}
          href={DEMO_APP_REPO_URL}
          target="_blank"
          rel="noreferrer"
        >
          GitHubで見る ↗
        </a>
        <Link className={`${styles.action} ${styles.extra}`} href="/">
          ログイン
        </Link>
      </div>
    </div>
  );
}
