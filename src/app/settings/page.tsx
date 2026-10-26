import { Header } from "@/components/Header";
import { MotionSetting } from "@/components/MotionSetting";
import { WatchedReposSetting, type WatchedRepoRow } from "@/components/WatchedReposSetting";
import { getGitHubToken } from "@/lib/auth";
import { getSettingsRepo } from "@/lib/config";
import { GitHubClient } from "@/lib/github/client";
import { hasPipeline, listReadableRepos } from "@/lib/github/settings";
import { loadWatchedRepos } from "@/lib/watchedRepos";

export default async function SettingsPage() {
  const { repos } = await loadWatchedRepos();
  const token = await getGitHubToken();
  const client = token ? new GitHubClient(token) : null;
  const editable = getSettingsRepo() !== null && client !== null;

  const [rows, options] = await Promise.all([
    Promise.all(
      repos.map(
        async (repo): Promise<WatchedRepoRow> => ({
          name: `${repo.owner}/${repo.repo}`,
          pipeline: client ? await hasPipeline(client, repo) : null,
        }),
      ),
    ),
    editable && client ? listReadableRepos(client).catch(() => []) : Promise.resolve([]),
  ]);

  return (
    <>
      <Header kind="settings" />
      <main className="content settings">
        <section className="settings-section" aria-labelledby="settings-repos">
          <h2 id="settings-repos" className="settings-title">
            監視するリポジトリ
          </h2>
          <WatchedReposSetting initialRows={rows} options={options} editable={editable} />
        </section>
        <section className="settings-section" aria-labelledby="settings-notify">
          <h2 id="settings-notify" className="settings-title">
            通知
          </h2>
        </section>
        <section className="settings-section" aria-labelledby="settings-motion">
          <h2 id="settings-motion" className="settings-title">
            動き
          </h2>
          <MotionSetting />
        </section>
      </main>
    </>
  );
}
