import { Backdrop } from "@/components/Backdrop";
import type { NotifyRepoRow } from "@/components/NotifySetting";
import { SettingsSections } from "@/components/SettingsSections";
import type { WatchedRepoRow } from "@/components/WatchedReposSetting";
import { getGitHubToken } from "@/lib/auth";
import { getSettingsRepo } from "@/lib/config";
import { GitHubClient } from "@/lib/github/client";
import { GitHubError } from "@/lib/github/errors";
import { hasPipeline, listReadableRepos, readVariable } from "@/lib/github/settings";
import { NOTIFY_EVENTS_VARIABLE, parseNotifyEvents } from "@/lib/notifyEvents";
import { loadWatchedRepos } from "@/lib/watchedRepos";

const GITHUB_FALLBACK_MESSAGE = "GitHubからデータを取れませんでした";

export default async function SettingsPage() {
  const { repos } = await loadWatchedRepos();
  const token = await getGitHubToken();
  const client = token ? new GitHubClient(token) : null;
  const editable = getSettingsRepo() !== null && client !== null;

  const [rows, options, notifyRows] = await Promise.all([
    Promise.all(
      repos.map(
        async (repo): Promise<WatchedRepoRow> => ({
          name: `${repo.owner}/${repo.repo}`,
          pipeline: client ? await hasPipeline(client, repo) : null,
        }),
      ),
    ),
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
    Promise.all(
      repos.map(async (repo): Promise<NotifyRepoRow> => {
        const name = `${repo.owner}/${repo.repo}`;
        if (!client) return { name, pipeline: false, events: parseNotifyEvents(null) };
        const pipeline = await hasPipeline(client, repo);
        // 読めなければ初期値を出す
        const value = pipeline
          ? await readVariable(client, repo, NOTIFY_EVENTS_VARIABLE).catch(() => null)
          : null;
        return { name, pipeline, events: parseNotifyEvents(value) };
      }),
    ),
  ]);

  return (
    <>
      <Backdrop />
      <SettingsSections
        repoRows={rows}
        repoOptions={options.names}
        repoOptionsError={options.error}
        editable={editable}
        notifyRows={notifyRows}
      />
    </>
  );
}
