"use client";

import { DEMO_REPO_OPTIONS, DEMO_REPOS, DEMO_TEMPLATE_REPO } from "@/lib/demo/data";
import { buildConversation } from "@/lib/conversation";
import { buildTrailEvents } from "@/lib/events";
import { parseNotifyEvents } from "@/lib/notifyEvents";
import { filterTurnItems } from "@/lib/turn";
import { useDemoState } from "./DemoContext";
import { Desk } from "./Desk";
import { NewIssueForm } from "./NewIssueForm";
import { SettingsSections } from "./SettingsSections";

/** デモのホーム：本物のホームと同じ部品に、サンプルのデータを渡す */
export function DemoHome() {
  const { results, items, now } = useDemoState();

  return (
    <Desk
      items={items}
      messages={buildConversation(results, buildTrailEvents(results, now), now)}
      now={now.toISOString()}
      scope={{ kind: "all", repoCount: DEMO_REPOS.length }}
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
      items={filterTurnItems(items, owner, repo)}
      messages={buildConversation(results, buildTrailEvents(results, now, { owner, repo }), now, { owner, repo })}
      now={now.toISOString()}
      scope={{ kind: "repo", owner, repo, githubUrl: null }}
      errors={[]}
      notices={[]}
    />
  );
}

const DEMO_REPO_NAMES = DEMO_REPOS.map(({ owner, repo }) => `${owner}/${repo}`);

/** デモのIssueを書く画面：GitHub には送らず、サンプルのデータにIssueが増える（landing-page はテンプレートの見本） */
export function DemoNewIssue() {
  return (
    <NewIssueForm
      repos={DEMO_REPOS.map(({ owner, repo }) => ({
        name: `${owner}/${repo}`,
        template: repo === DEMO_TEMPLATE_REPO,
      }))}
    />
  );
}

/** デモの設定：保存を押しても書き込まない（アニメーションだけは、このブラウザに本当に保存する） */
export function DemoSettings() {
  return (
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
  );
}
