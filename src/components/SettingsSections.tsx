import { MotionSetting } from "./MotionSetting";
import { NotifySetting, type NotifyRepoRow } from "./NotifySetting";
import { WatchedReposSetting, type WatchedRepoRow } from "./WatchedReposSetting";

type Props = {
  repoRows: WatchedRepoRow[];
  /** 追加の欄に出すリポジトリ（`owner/repo`） */
  repoOptions: string[];
  /** 監視するリポジトリを変えられるか */
  editable: boolean;
  notifyRows: NotifyRepoRow[];
};

/** 設定画面の中身：監視するリポジトリ・通知・アニメーション（本物とデモで同じ物） */
export function SettingsSections({ repoRows, repoOptions, editable, notifyRows }: Props) {
  return (
    <main className="content settings">
      <section className="settings-section" aria-labelledby="settings-repos">
        <h2 id="settings-repos" className="settings-title">
          監視するリポジトリ
        </h2>
        <WatchedReposSetting initialRows={repoRows} options={repoOptions} editable={editable} />
      </section>
      <section className="settings-section" aria-labelledby="settings-notify">
        <h2 id="settings-notify" className="settings-title">
          通知
        </h2>
        <NotifySetting rows={notifyRows} />
      </section>
      <section className="settings-section" aria-labelledby="settings-motion">
        <h2 id="settings-motion" className="settings-title">
          アニメーション
        </h2>
        <MotionSetting />
      </section>
    </main>
  );
}
