import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadStepLog } from "@/app/actions";
import { DeskLive } from "@/components/LivePages";
import { getGitHubToken, getSignedInLogin } from "@/lib/auth";
import { buildConversation } from "@/lib/conversation";
import { buildTrailEvents } from "@/lib/events";
import { findWatchedRepo } from "@/lib/config";
import { loadRepoSteps } from "@/lib/loadTurnSteps";
import { newIssueRepos } from "@/lib/newIssue";
import { buildTurnItems } from "@/lib/turn";
import { loadWatchedRepos } from "@/lib/watchedRepos";
import { buildWatchdogNotices } from "@/lib/watchdogState";
import { logout } from "../../../logout";

const NO_COUNTS = { byRepo: {} };

/** タブの題名はリポジトリ名（docs/spec.md の「タブの題名」） */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ owner: string; repo: string }>;
}): Promise<Metadata> {
  const { repo } = await params;
  return { title: repo };
}

/**
 * そのリポジトリの中身（あなたの番・いまの様子）は、そのリポジトリの取得だけで描く。
 * 他のリポジトリの件数・Issueを書く欄の一覧などは、layout が後から流す（`Desk` の `nav.countsPending`）。
 * 取得は `getRepoResult` で、layout の全リポジトリの取得と同じ結果を使い回す（GitHub の呼び出しは増えない）
 */
export default async function RepoPage({
  params,
}: {
  params: Promise<{ owner: string; repo: string }>;
}) {
  const { owner, repo } = await params;
  const { repos } = await loadWatchedRepos();
  const watched = findWatchedRepo(owner, repo, repos);
  if (!watched) notFound();

  // ログインしていなければ、layout がログインの画面を出す
  const token = await getGitHubToken();
  if (!token) return null;

  // 新しい結果が遅いときは、覚えている最後の結果を先に出し、届いたら入れ替える（`loadRepoSteps`）
  const login = (await getSignedInLogin()) ?? undefined;
  const first = await loadRepoSteps(token, watched, (result, complete) => {
    const results = [result];
    const now = new Date();
    return {
      complete,
      props: {
        items: buildTurnItems(results, now),
        messages: buildConversation(results, buildTrailEvents(results, now, watched), now, watched),
        now: now.toISOString(),
        scope: {
          kind: "repo" as const,
          owner: watched.owner,
          repo: watched.repo,
          githubUrl: `https://github.com/${watched.owner}/${watched.repo}`,
        },
        errors: result.ok ? [] : [{ repo: `${result.owner}/${result.repo}`, message: result.error.message }],
        notices: buildWatchdogNotices(results, now),
        nav: { repos, counts: NO_COUNTS, runningCounts: NO_COUNTS, countsPending: true, login, logout },
        newIssueRepos: newIssueRepos(repos, results),
        loadStepLog,
      },
    };
  });
  return <DeskLive first={first} />;
}
