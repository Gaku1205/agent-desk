import { cookies } from "next/headers";
import { Setup } from "@/components/Setup";
import { getGitHubToken, getSignedInLogin } from "@/lib/auth";
import { fetchOwnedRepos } from "@/lib/github/autoAdd";
import { GitHubClient } from "@/lib/github/client";
import { fetchTokenScopes, loadSetupFacts } from "@/lib/github/setup";
import {
  computeSetupSteps,
  EMPTY_FACTS,
  hasRepoScope,
  INSTALLED_COOKIE,
  isInstalledRepo,
  setupErrorMessage,
  templateReposOf,
} from "@/lib/setupState";
import { loadWatchedRepos } from "@/lib/watchedRepos";

/** 導入：段の状態は、開くたびに GitHub から求める（データベースは持たない） */
export default async function SetupPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const repoParam = typeof params.repo === "string" ? params.repo : null;
  const login = await getSignedInLogin();
  const token = await getGitHubToken();
  if (!login || !token) return null;

  const client = new GitHubClient(token);
  const installedCookie = (await cookies()).get(INSTALLED_COOKIE)?.value;
  const [{ facts, notTarget }, scopes] = await Promise.all([
    loadSetupFacts(client, login, repoParam, (repo) => isInstalledRepo(installedCookie, repo)).catch(() => ({
      facts: EMPTY_FACTS,
      notTarget: false,
    })),
    fetchTokenScopes(token),
  ]);
  const steps = computeSetupSteps(facts);
  // `作ってあるリポジトリを使う` の選択肢は、Repository が今の段のときだけ読む
  const templateRepos =
    steps.current === "repo"
      ? await fetchOwnedRepos(client).then(
          (owned) => templateReposOf(owned, login),
          () => [] as string[],
        )
      : [];
  const watched = facts.repo
    ? (await loadWatchedRepos()).repos.some(
        (repo) => `${repo.owner}/${repo.repo}`.toLowerCase() === facts.repo?.toLowerCase(),
      )
    : false;

  return (
    <Setup
      key={facts.repo ?? ""}
      login={login}
      facts={facts}
      notTarget={notTarget}
      canWrite={hasRepoScope(scopes)}
      templateRepos={templateRepos}
      notice={setupErrorMessage(params.error)}
      watched={watched}
    />
  );
}
