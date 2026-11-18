import { notFound } from "next/navigation";
import { loadStepLog } from "@/app/actions";
import { Desk } from "@/components/Desk";
import { getGitHubToken, getSignedInLogin } from "@/lib/auth";
import { buildConversation } from "@/lib/conversation";
import { buildTrailEvents } from "@/lib/events";
import { findWatchedRepo } from "@/lib/config";
import { getRepoResult } from "@/lib/github/fetch";
import { newIssueRepos } from "@/lib/newIssue";
import { buildTurnItems } from "@/lib/turn";
import { loadWatchedRepos } from "@/lib/watchedRepos";
import { buildWatchdogNotices } from "@/lib/watchdogState";
import { logout } from "../../../logout";

const NO_COUNTS = { byRepo: {} };

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

  const result = await getRepoResult(token, watched);
  const results = [result];
  const now = new Date();

  return (
    <Desk
      items={buildTurnItems(results, now)}
      messages={buildConversation(results, buildTrailEvents(results, now, watched), now, watched)}
      now={now.toISOString()}
      scope={{
        kind: "repo",
        owner: watched.owner,
        repo: watched.repo,
        githubUrl: `https://github.com/${watched.owner}/${watched.repo}`,
      }}
      errors={result.ok ? [] : [{ repo: `${result.owner}/${result.repo}`, message: result.error.message }]}
      notices={buildWatchdogNotices(results, now)}
      nav={{
        repos,
        counts: NO_COUNTS,
        runningCounts: NO_COUNTS,
        countsPending: true,
        login: (await getSignedInLogin()) ?? undefined,
        logout,
      }}
      newIssueRepos={newIssueRepos(repos, results)}
      loadStepLog={loadStepLog}
    />
  );
}
