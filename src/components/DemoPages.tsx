"use client";

import { useCallback } from "react";
import { notFound } from "next/navigation";
import { demoStepLog } from "@/lib/demo/stepLog";
import { findWatchedRepo, type WatchedRepo } from "@/lib/config";
import { DEMO_BASE_PATH, DEMO_REPO_OPTIONS, DEMO_TEMPLATE_REPO } from "@/lib/demo/data";
import { buildConversation } from "@/lib/conversation";
import { buildTrailEvents } from "@/lib/events";
import { parseNotifyEvents } from "@/lib/notifyEvents";
import { DEFAULT_PARALLEL_SETTINGS } from "@/lib/parallel";
import { countRunningPipelineRows } from "@/lib/runningPipeline";
import { countTurnItems, filterTurnItems } from "@/lib/turn";
import { useDemoState } from "./DemoContext";
import { Desk, type DeskNav } from "./Desk";
import { NewIssueForm } from "./NewIssueForm";
import { SettingsSections } from "./SettingsSections";

/** Issueを書く欄のリポジトリ（landing-page はテンプレートの見本） */
function newIssueRepos(repos: WatchedRepo[]) {
  return repos.map(({ owner, repo }) => ({ name: `${owner}/${repo}`, template: repo === DEMO_TEMPLATE_REPO }));
}

/** PCの3ペインの左の一覧（上端の帯と同じ数） */
function useDemoNav(): DeskNav {
  const { results, items, now, repos } = useDemoState();
  return {
    repos,
    counts: countTurnItems(items),
    runningCounts: countRunningPipelineRows(results, now),
    basePath: DEMO_BASE_PATH,
  };
}

/** 進捗図の記録：サンプルのデータの進捗ログを読む（データが変わるまで同じ関数） */
function useDemoStepLog() {
  const { results, now } = useDemoState();
  return useCallback(
    async (owner: string, repo: string, number: number) => demoStepLog(results, owner, repo, number, now),
    [results, now],
  );
}

/** デモのホーム：本物のホームと同じ部品に、サンプルのデータを渡す */
export function DemoHome() {
  const { results, items, now, repos, addedNotices } = useDemoState();
  const nav = useDemoNav();
  const loadStepLog = useDemoStepLog();

  return (
    <Desk
      items={items}
      messages={buildConversation(results, buildTrailEvents(results, now), now)}
      now={now.toISOString()}
      scope={{ kind: "all", repoCount: repos.length }}
      errors={[]}
      notices={[]}
      addedNotices={addedNotices}
      nav={nav}
      newIssueRepos={newIssueRepos(repos)}
      loadStepLog={loadStepLog}
      hideUnknownModel
    />
  );
}

/** デモのリポジトリのページ */
export function DemoRepo({ owner, repo }: { owner: string; repo: string }) {
  const { results, items, now, repos, addedNotices } = useDemoState();
  const nav = useDemoNav();
  const loadStepLog = useDemoStepLog();
  // 自動で足すリポジトリ（morning-card）は、足すまでは見つからない
  if (!findWatchedRepo(owner, repo, repos)) notFound();

  return (
    <Desk
      items={filterTurnItems(items, owner, repo)}
      messages={buildConversation(results, buildTrailEvents(results, now, { owner, repo }), now, { owner, repo })}
      now={now.toISOString()}
      scope={{ kind: "repo", owner, repo, githubUrl: null }}
      errors={[]}
      notices={[]}
      addedNotices={addedNotices.filter((notice) => notice.owner === owner && notice.repo === repo)}
      nav={nav}
      newIssueRepos={newIssueRepos(repos)}
      loadStepLog={loadStepLog}
      hideUnknownModel
    />
  );
}

/** デモのIssueを書く画面：GitHub には送らず、サンプルのデータにIssueが増える（landing-page はテンプレートの見本） */
export function DemoNewIssue() {
  const { repos } = useDemoState();
  return <NewIssueForm repos={newIssueRepos(repos)} />;
}

/** デモの新しいサービスを作る画面：送り先はテンプレートの見本（landing-page）だけ */
export function DemoNewService() {
  const { repos } = useDemoState();
  return <NewIssueForm mode="service" repos={newIssueRepos(repos).filter((repo) => repo.template)} />;
}

/**
 * デモの設定：保存を押しても書き込まない（アニメーションだけは、このブラウザに本当に保存する）。
 * 「新しいサービスを自動で追加」は、サンプルの動き（工場が作ったリポジトリを足すか）だけを変える
 */
export function DemoSettings() {
  const { repos, autoAdd } = useDemoState();
  const names = repos.map(({ owner, repo }) => `${owner}/${repo}`);
  return (
    <SettingsSections
      repoRows={names.map((name) => ({ name, pipeline: true }))}
      repoOptions={DEMO_REPO_OPTIONS}
      editable
      notifyRows={names.map((name) => ({
        name,
        pipeline: true,
        events: parseNotifyEvents(null),
      }))}
      autoAdd={autoAdd}
      parallel={DEFAULT_PARALLEL_SETTINGS}
    />
  );
}
