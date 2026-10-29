"use client";

import Link from "next/link";
import { DEMO_APP_REPO_URL, DEMO_BASE_PATH, DEMO_REPOS } from "@/lib/demo/data";
import { countRunningPipelineRows } from "@/lib/runningPipeline";
import { countTurnItems } from "@/lib/turn";
import { useDemoState } from "./DemoContext";
import { TopBar } from "./TopBar";
import styles from "./TopBar.module.css";

/** デモの上端の帯。本物と同じ部品で、リンクの頭が `/demo`。ユーザー名の代わりに、メニューに「GitHubで見る」「ログイン」 */
export function DemoTopBar() {
  const { items, results, now } = useDemoState();

  return (
    <TopBar
      repos={DEMO_REPOS}
      counts={countTurnItems(items)}
      runningCounts={countRunningPipelineRows(results, now)}
      basePath={DEMO_BASE_PATH}
      extraLinks={
        <>
          <a className={styles.lnk} href={DEMO_APP_REPO_URL} target="_blank" rel="noreferrer">
            GitHubで見る ↗
          </a>
          <Link className={styles.lnk} href="/">
            ログイン
          </Link>
        </>
      }
    />
  );
}
