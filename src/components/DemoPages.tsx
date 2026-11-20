"use client";

import { useCallback } from "react";
import { notFound } from "next/navigation";
import { demoStepLog } from "@/lib/demo/stepLog";
import { findWatchedRepo, type WatchedRepo } from "@/lib/config";
import { DEMO_BASE_PATH, DEMO_PARALLEL_SETTINGS, DEMO_REPO_OPTIONS, DEMO_TEMPLATE_REPO } from "@/lib/demo/data";
import { buildConversation } from "@/lib/conversation";
import { buildTrailEvents } from "@/lib/events";
import { parseNotifyEvents } from "@/lib/notifyEvents";
import { countRunningPipelineRows } from "@/lib/runningPipeline";
import { countTurnItems, filterTurnItems } from "@/lib/turn";
import { buildBundle, type PeriodBundle } from "@/lib/dashboard/bundle";
import { hourStarts, type GithubLimits } from "@/lib/dashboard/githubLimits";
import { PERIOD_KEYS, type PeriodKey } from "@/lib/dashboard/period";
import { buildServiceRows, type ServicesView } from "@/lib/dashboard/services";
import { recentDateKeys } from "@/lib/usage/cpuBudget";
import { buildLanesSource } from "@/lib/lanes/source";
import { buildUsageSource } from "@/lib/lanes/usage";
import { Dashboard } from "./Dashboard";
import { Lanes } from "./Lanes";
import { useDemoState } from "./DemoContext";
import { Desk, type DeskNav } from "./Desk";
import { buildRepoRows } from "@/lib/repoList";
import { NewIssueForm } from "./NewIssueForm";
import { RepoList } from "./RepoList";
import { SettingsSections } from "./SettingsSections";
import { Setup } from "./Setup";
import { EMPTY_FACTS } from "@/lib/setupState";

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

/** デモのすべてのリポジトリ：0・0 の物と数のある物の両方が並ぶ */
export function DemoRepos() {
  const { results, items, now, repos } = useDemoState();
  const nav = useDemoNav();
  return <RepoList rows={buildRepoRows(repos, results, items, now)} now={now.toISOString()} nav={nav} />;
}

/** デモの GitHub limits：デモのデータ（途中に足りない時間帯が1つ、上限を超えた時間帯が1つ） */
function demoGithubLimits(now: Date, runs: number | null): GithubLimits {
  const reset = Math.floor(now.getTime() / 1000) + 22 * 60;
  const pipelineUsed: (number | null)[] = [
    420, 380, 150, 90, 60, 40, 30, 20, 25, 60, 410, 880, 1500, 2100, 2650, 3100, 2400, 5200, 3900, 1800, null, 900, 1300, 1088,
  ];
  const readsUsed: (number | null)[] = [
    80, 60, 40, 40, 30, 30, 20, 20, 30, 90, 160, 240, 310, 380, 420, 380, 350, 410, 380, 300, null, 180, 220, 240,
  ];
  return {
    pipeline: { remaining: 3912, limit: 5000, resetAt: reset },
    reads: { remaining: 4620, limit: 5000, resetAt: reset },
    hourStarts: hourStarts(now.getTime()),
    pipelineUsed,
    readsUsed,
    runs,
  };
}

/** デモの Services：Supabase の失敗が1つ・よい物が1つ、Vercel の CPU は直近の日ごとの合計 */
function demoServices(now: Date, limits: GithubLimits): ServicesView {
  const nowMs = now.getTime();
  const hour = 60 * 60 * 1000;
  const keys = recentDateKeys(now, 30);
  const daily = [222_000, 380_000, 410_000, 290_000, 350_000, 330_000, 300_000, 260_000, 240_000, 310_000];
  const cpuTotals = new Map(keys.slice(0, daily.length).map((key, i) => [key, daily[i]]));
  return {
    checkedAt: now.toISOString(),
    rows: buildServiceRows({
      supabase: [
        {
          owner: "demo",
          repo: "tide-almanac",
          ok: true,
          at: nowMs - 2 * hour,
          failingSince: null,
          message: null,
          logUrl: null,
        },
        {
          owner: "demo",
          repo: "loss-lab",
          ok: false,
          at: nowMs - 3 * hour,
          failingSince: nowMs - 2 * 24 * hour - 3 * hour,
          message: "Supabase project is paused. Resume it from https://supabase.com/dashboard/project/demo",
          logUrl: null,
        },
      ],
      cpuTotals,
      limits,
      now,
    }),
  };
}

/** デモの Dashboard：デモのデータで、本物と同じ集計を出す */
export function DemoDashboard({ initialPeriod }: { initialPeriod?: PeriodKey }) {
  const { dashboardResults, now, repos } = useDemoState();
  const nav = useDemoNav();
  // Dashboard のデモのデータは60日分あるので、`30d` も含めて全部の期間をここで数える（取得は無い）
  const bundles = Object.fromEntries(PERIOD_KEYS.map((key) => [key, buildBundle(dashboardResults, now, key)])) as Record<
    PeriodKey,
    PeriodBundle
  >;
  const limits = demoGithubLimits(now, bundles["24h"].summary.runs);
  return (
    <Dashboard
      bundles={bundles}
      limits={limits}
      services={demoServices(now, limits)}
      now={now.toISOString()}
      repoCount={repos.length}
      nav={nav}
      initialPeriod={initialPeriod}
    />
  );
}

/** デモの Slots & Queue：デモのデータで、本物と同じ部品 */
export function DemoLanes() {
  const { results, items, now } = useDemoState();
  const nav = useDemoNav();
  return (
    <Lanes
      source={buildLanesSource(results, now)}
      usage={buildUsageSource(results, now)}
      items={items}
      now={now.toISOString()}
      nav={nav}
    />
  );
}

/** デモのIssueを書く画面：GitHub には送らず、サンプルのデータにIssueが増える（landing-page はテンプレートの見本） */
export function DemoNewIssue({ initialRepo }: { initialRepo?: string }) {
  const { repos } = useDemoState();
  return <NewIssueForm repos={newIssueRepos(repos)} initialRepo={initialRepo} />;
}

/** デモの新しいサービスを作る画面：送り先はテンプレートの見本（landing-page）だけ */
export function DemoNewService() {
  const { repos } = useDemoState();
  const nav = useDemoNav();
  return <NewIssueForm mode="service" repos={newIssueRepos(repos).filter((repo) => repo.template)} nav={nav} />;
}

/** デモの導入：同じ画面。何も書き込まず、押すと次の段へ進むだけ */
export function DemoSetup() {
  return (
    <Setup
      login="demo"
      facts={EMPTY_FACTS}
      notTarget={false}
      canWrite
      templateRepos={[]}
      notice={null}
      watched={false}
    />
  );
}

/**
 * デモの設定：変えても書き込まない（テーマ・アニメーションだけは、このブラウザに本当に保存する）。
 * `Auto-add` は、サンプルの動き（工場が作ったリポジトリを足すか）だけを変える
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
      parallel={DEMO_PARALLEL_SETTINGS}
    />
  );
}
