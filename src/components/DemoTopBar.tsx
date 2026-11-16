"use client";

import Link from "next/link";
import { DEMO_APP_REPO_URL, DEMO_BASE_PATH } from "@/lib/demo/data";
import { countRunningPipelineRows } from "@/lib/runningPipeline";
import { countTurnItems } from "@/lib/turn";
import { useDemoState } from "./DemoContext";
import { BranchIcon, LoginIcon } from "./icons";
import { TopBar } from "./TopBar";
import styles from "./TopBar.module.css";

/** デモの上端の帯。本物と同じ部品で、リンクの頭が `/demo`。ユーザー名の代わりに、メニューに「GitHubで見る」「ログイン」 */
export function DemoTopBar() {
  const { items, results, now, repos } = useDemoState();

  return (
    <TopBar
      repos={repos}
      counts={countTurnItems(items)}
      runningCounts={countRunningPipelineRows(results, now)}
      basePath={DEMO_BASE_PATH}
      extraLinks={
        <>
          <a className={styles.lnk} href={DEMO_APP_REPO_URL} target="_blank" rel="noreferrer">
            <BranchIcon />
            GitHubで見る ↗
          </a>
          <Link className={styles.lnk} href="/">
            <LoginIcon />
            ログイン
          </Link>
        </>
      }
    />
  );
}
