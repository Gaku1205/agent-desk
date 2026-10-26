"use client";

import Link from "next/link";
import { DEMO_APP_REPO_URL } from "@/lib/demo/data";
import { PLAY_BUTTON_LABEL } from "@/lib/demo/playback";
import { useDemoState } from "./DemoContext";

/** デモの帯（画面のいちばん上）。スマホでは文言を短くし、右は「再生 ▶」だけ（ほかはメニューの中） */
export function DemoBanner() {
  const { playState, play } = useDemoState();

  return (
    <div className="demo-banner">
      <p className="demo-banner-text">
        <span className="demo-banner-dot" aria-hidden="true" />
        <span className="demo-banner-long">
          デモ：サンプルのデータです。ボタンを押しても実際には何も起きません
        </span>
        <span className="demo-banner-short">デモ（サンプルのデータ）</span>
      </p>
      <div className="demo-banner-actions">
        <button
          type="button"
          className="demo-banner-action"
          onClick={play}
          disabled={playState === "playing"}
          aria-live="polite"
        >
          {PLAY_BUTTON_LABEL[playState]}
        </button>
        <a
          className="demo-banner-action demo-banner-extra"
          href={DEMO_APP_REPO_URL}
          target="_blank"
          rel="noreferrer"
        >
          GitHubで見る ↗
        </a>
        <Link className="demo-banner-action demo-banner-extra" href="/">
          ログイン
        </Link>
      </div>
    </div>
  );
}
