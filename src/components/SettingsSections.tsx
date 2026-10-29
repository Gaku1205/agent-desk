"use client";

import { useState } from "react";
import { MotionSetting } from "./MotionSetting";
import { Sheet } from "./Sheet";
import { NotifySetting, type NotifyRepoRow } from "./NotifySetting";
import styles from "./SettingsSections.module.css";
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
  // 「外す」を押したリポジトリ。保存前でも、通知の表からその列を消す
  const [removed, setRemoved] = useState<ReadonlySet<string>>(new Set());
  const shownNotifyRows = notifyRows.filter((row) => !removed.has(row.name));

  function handleListChange(names: string[]) {
    const listed = new Set(names);
    setRemoved(new Set(repoRows.filter((row) => !listed.has(row.name)).map((row) => row.name)));
  }

  return (
    <Sheet>
      <h1 className={styles.h1}>設定</h1>
      <section className={styles.section} aria-labelledby="settings-repos">
        <h2 id="settings-repos" className={styles.title}>
          監視するリポジトリ
        </h2>
        <WatchedReposSetting
          initialRows={repoRows}
          options={repoOptions}
          editable={editable}
          onListChange={handleListChange}
        />
      </section>
      <section className={styles.section} aria-labelledby="settings-notify">
        <h2 id="settings-notify" className={styles.title}>
          通知
        </h2>
        <NotifySetting rows={shownNotifyRows} />
      </section>
      <section className={styles.section} aria-labelledby="settings-motion">
        <h2 id="settings-motion" className={styles.title}>
          アニメーション
        </h2>
        <MotionSetting />
      </section>
    </Sheet>
  );
}
