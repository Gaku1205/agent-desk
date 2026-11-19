import { chooseWatchedRepos, getSettingsRepo } from "@/lib/config";
import { getRepoResult } from "@/lib/github/fetch";
import {
  fetchInstallationRepositories,
  fetchPipelineInstallationAppId,
  readWatchedVariableWith,
} from "@/lib/github/selfcheck";
import type { RepoResult } from "@/lib/github/types";
import { isSelfcheckKeyAccepted, parseBearer, watchedAmong, parseInstallationRepositories } from "@/lib/selfcheck/auth";
import { selfcheckOnce, selfcheckScopeKey } from "@/lib/selfcheck/run";

const NO_STORE = { "Cache-Control": "no-store" };

function unauthorized(): Response {
  return new Response(null, { status: 401, headers: NO_STORE });
}

/**
 * 自己点検（docs/spec.md の「自己点検」）。GitHub の状態と画面に出す物のずれを見つける。
 * 呼ぶ側はパイプラインの GitHub App のインストールの鍵を `Authorization: Bearer` で付ける。
 * 読めたリポジトリに監視リポジトリが含まれ、鍵の App の ID が `PIPELINE_APP_ID` と同じときだけ受け付ける（それ以外は 401・本文なし）。
 * 鍵はログにも返事にも出さず、覚えない。結果は5分、サーバーのメモリに覚える
 */
export async function POST(request: Request): Promise<Response> {
  const token = parseBearer(request.headers.get("authorization"));
  const appId = process.env.PIPELINE_APP_ID?.trim();
  if (!token || !appId) return unauthorized();

  const installation = await fetchInstallationRepositories(token);
  if (!installation) return unauthorized();

  const settingsRepo = getSettingsRepo();
  const variable = settingsRepo ? await readWatchedVariableWith(token, settingsRepo) : null;
  const { repos } = chooseWatchedRepos(variable);
  const reachable = watchedAmong(parseInstallationRepositories(installation), repos);
  if (reachable.length === 0) return unauthorized();

  const keyAppId = await fetchPipelineInstallationAppId(reachable[0]);
  if (!isSelfcheckKeyAccepted({ installationRepositories: installation, watched: repos, appId, keyAppId })) {
    return unauthorized();
  }

  const scope = selfcheckScopeKey(reachable.map(({ owner, repo }) => `${owner}/${repo}`));
  const report = await selfcheckOnce(
    scope,
    (): Promise<RepoResult[]> => Promise.all(repos.map((repo) => getRepoResult(token, repo))),
  );
  return Response.json(report, { headers: NO_STORE });
}
