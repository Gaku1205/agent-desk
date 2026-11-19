import type { NotifyRepoRow } from "@/components/NotifySetting";
import { SettingsSections } from "@/components/SettingsSections";
import type { WatchedRepoRow } from "@/components/WatchedReposSetting";
import { getGitHubToken } from "@/lib/auth";
import { parseAutoAddEnabled } from "@/lib/autoAdd";
import { AUTO_ADD_VARIABLE } from "@/lib/github/autoAdd";
import { getSettingsRepo } from "@/lib/config";
import { GitHubClient } from "@/lib/github/client";
import { GitHubError } from "@/lib/github/errors";
import { cachedHasPipeline } from "@/lib/github/pipelineCache";
import { listReadableRepos, readParallelSettings, readVariable } from "@/lib/github/settings";
import { DEFAULT_PARALLEL_SETTINGS } from "@/lib/parallel";
import { NOTIFY_EVENTS_VARIABLE, parseNotifyEvents } from "@/lib/notifyEvents";
import { loadWatchedRepos } from "@/lib/watchedRepos";

export const metadata = { title: "設定" };

const GITHUB_FALLBACK_MESSAGE = "GitHubからデータを取れませんでした";

export default async function SettingsPage() {
  const { repos } = await loadWatchedRepos();
  const token = await getGitHubToken();
  const client = token ? new GitHubClient(token) : null;
  const editable = getSettingsRepo() !== null && client !== null;

  const settingsRepo = getSettingsRepo();
  // リポジトリごとの hasPipeline は1回だけ（一覧と通知で同じ結果を使う。10分は覚えている）。ほかの読み取りと同時に始める
  const pipelinesPromise = Promise.all(
    repos.map((repo) => (client && token ? cachedHasPipeline(client, token, repo) : Promise.resolve(null))),
  );
  const [pipelines, options, autoAdd, parallel] = await Promise.all([
    pipelinesPromise,
    editable && client
      ? listReadableRepos(client).then(
          (names) => ({ names, error: null as string | null }),
          (error: unknown) => ({
            names: [] as string[],
            // GitHubErrorの文は固定の日本語だけ（トークンや返事の中身は含まない）
            error: error instanceof GitHubError ? error.message : GITHUB_FALLBACK_MESSAGE,
          }),
        )
      : Promise.resolve({ names: [] as string[], error: null as string | null }),
    // 「新しいサービスを自動で追加」。読めなければ初期のオンとして出す
    editable && client && settingsRepo
      ? readVariable(client, settingsRepo, AUTO_ADD_VARIABLE).then(parseAutoAddEnabled, () => true)
      : Promise.resolve(null),
    // 「並列」。SETTINGS_REPO の Variable から読み、読めなければ既定（昼3・夜1・夜の時間帯なし）
    editable && client && settingsRepo
      ? readParallelSettings(client, settingsRepo).catch(() => DEFAULT_PARALLEL_SETTINGS)
      : Promise.resolve(null),
  ]);

  const rows: WatchedRepoRow[] = repos.map((repo, i) => ({
    name: `${repo.owner}/${repo.repo}`,
    pipeline: pipelines[i],
  }));
  // 通知の初期値は、パイプラインのあるリポジトリだけ読む。読めなければ初期値を出す
  const notifyRows = await Promise.all(
    repos.map(async (repo, i): Promise<NotifyRepoRow> => {
      const name = `${repo.owner}/${repo.repo}`;
      const pipeline = pipelines[i] === true;
      const value =
        client && pipeline ? await readVariable(client, repo, NOTIFY_EVENTS_VARIABLE).catch(() => null) : null;
      return { name, pipeline, events: parseNotifyEvents(value) };
    }),
  );

  return (
    <SettingsSections
      repoRows={rows}
      repoOptions={options.names}
      repoOptionsError={options.error}
      editable={editable}
      notifyRows={notifyRows}
      autoAdd={autoAdd}
      parallel={parallel}
    />
  );
}
