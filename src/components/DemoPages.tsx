"use client";

import { DEMO_REPO_OPTIONS, DEMO_REPOS } from "@/lib/demo/data";
import { buildTrailEvents } from "@/lib/events";
import { buildFlowNodes } from "@/lib/flow/nodes";
import { parseNotifyEvents } from "@/lib/notifyEvents";
import { countTurnItems, filterTurnItems } from "@/lib/turn";
import { Backdrop } from "./Backdrop";
import { useDemoState } from "./DemoContext";
import { Desk } from "./Desk";
import { SettingsSections } from "./SettingsSections";

/** デモのホーム：本物のホームと同じ部品に、サンプルのデータを渡す */
export function DemoHome() {
  const { results, items, now } = useDemoState();
  const counts = countTurnItems(items);

  return (
    <Desk
      nodes={buildFlowNodes(results, now)}
      items={items}
      events={buildTrailEvents(results, now)}
      now={now.toISOString()}
      scope={{
        kind: "all",
        repos: DEMO_REPOS.map(({ owner, repo }) => ({ repo, count: counts.byRepo[`${owner}/${repo}`] ?? 0 })),
      }}
      errors={[]}
      notices={[]}
    />
  );
}

/** デモのリポジトリのページ */
export function DemoRepo({ owner, repo }: { owner: string; repo: string }) {
  const { results, items, now } = useDemoState();

  return (
    <Desk
      nodes={buildFlowNodes(results, now, { owner, repo })}
      items={filterTurnItems(items, owner, repo)}
      events={buildTrailEvents(results, now, { owner, repo })}
      now={now.toISOString()}
      scope={{ kind: "repo", owner, repo, githubUrl: null }}
      errors={[]}
      notices={[]}
    />
  );
}

const DEMO_REPO_NAMES = DEMO_REPOS.map(({ owner, repo }) => `${owner}/${repo}`);

/** デモの設定：保存を押しても書き込まない（アニメーションだけは、このブラウザに本当に保存する） */
export function DemoSettings() {
  return (
    <>
      <Backdrop />
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
