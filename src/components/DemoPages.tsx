"use client";

import { DEMO_REPO_OPTIONS, DEMO_REPOS } from "@/lib/demo/data";
import { buildRecentEvents } from "@/lib/events";
import { parseNotifyEvents } from "@/lib/notifyEvents";
import { buildPipelineRows } from "@/lib/pipeline";
import { buildRunningPipelineRows } from "@/lib/runningPipeline";
import { filterTurnItems } from "@/lib/turn";
import { buildWaitingPipelineRows } from "@/lib/waitingPipeline";
import { useDemoState } from "./DemoContext";
import { EventSection } from "./EventSection";
import { Header } from "./Header";
import { PipelineTable } from "./PipelineTable";
import { RunningPipelineSection } from "./RunningPipelineSection";
import { SettingsSections } from "./SettingsSections";
import { TurnSection } from "./TurnSection";
import { WaitingPipelineSection } from "./WaitingPipelineSection";

/** デモのホーム：本物のホームと同じ部品に、サンプルのデータを渡す */
export function DemoHome() {
  const { results, items, now } = useDemoState();

  return (
    <>
      <Header kind="home" />
      <main className="content">
        <TurnSection items={items} errors={[]} now={now} scope="all" />
        <WaitingPipelineSection rows={buildWaitingPipelineRows(results, now)} />
        <RunningPipelineSection rows={buildRunningPipelineRows(results, now)} />
        <EventSection events={buildRecentEvents(results, now)} now={now} />
      </main>
    </>
  );
}

/** デモのリポジトリのページ */
export function DemoRepo({ owner, repo }: { owner: string; repo: string }) {
  const { results, items, now } = useDemoState();
  const result = results.find((r) => r.owner === owner && r.repo === repo);
  const rows = result?.ok ? buildPipelineRows(result.data, now, `${owner}/${repo}`) : [];

  return (
    <>
      <Header kind="repo" owner={owner} repo={repo} githubLink={false} />
      <main className="content">
        <TurnSection items={filterTurnItems(items, owner, repo)} errors={[]} now={now} scope="repo" />
        <PipelineTable rows={rows} repoName={repo} />
      </main>
    </>
  );
}

const DEMO_REPO_NAMES = DEMO_REPOS.map(({ owner, repo }) => `${owner}/${repo}`);

/** デモの設定：保存を押しても書き込まない（アニメーションだけは、このブラウザに本当に保存する） */
export function DemoSettings() {
  return (
    <>
      <Header kind="settings" />
      <SettingsSections
        repoRows={DEMO_REPO_NAMES.map((name) => ({ name, pipeline: true }))}
        repoOptions={DEMO_REPO_OPTIONS}
        editable
        notifyRows={DEMO_REPO_NAMES.map((name) => ({
          name,
          pipeline: true,
          events: parseNotifyEvents(null),
        }))}
      />
    </>
  );
}
