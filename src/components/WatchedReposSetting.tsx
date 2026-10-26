"use client";

import { useEffect, useState, useTransition } from "react";
import { checkPipeline, saveWatchedRepos } from "@/app/(app)/settings/actions";
import { useDemo } from "./DemoContext";
import settingsStyles from "./SettingsSections.module.css";
import styles from "./WatchedReposSetting.module.css";

export type WatchedRepoRow = {
  /** `owner/repo` */
  name: string;
  /** パイプラインがあるか。まだ調べていなければ null */
  pipeline: boolean | null;
};

type Props = {
  initialRows: WatchedRepoRow[];
  /** 追加の欄に出す、ログイン中のユーザーが読めるリポジトリ（`owner/repo`） */
  options: string[];
  /** `SETTINGS_REPO` が無ければ false（見るだけ） */
  editable: boolean;
};

type Status = { kind: "idle" } | { kind: "saved" } | { kind: "error"; message: string };

/** 設定画面の「監視するリポジトリ」。保存はサーバー側（Server Action）で行う */
export function WatchedReposSetting({ initialRows, options, editable }: Props) {
  const [rows, setRows] = useState(initialRows);
  const [selected, setSelected] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [saving, startSaving] = useTransition();
  const demo = useDemo();

  useEffect(() => {
    if (status.kind !== "saved") return;
    const timer = window.setTimeout(() => setStatus({ kind: "idle" }), 2000);
    return () => window.clearTimeout(timer);
  }, [status]);

  const listed = new Set(rows.map((row) => row.name.toLowerCase()));
  const choices = options.filter((name) => !listed.has(name.toLowerCase()));
  const current = choices.includes(selected) ? selected : (choices[0] ?? "");

  function remove(name: string) {
    setRows((prev) => prev.filter((row) => row.name !== name));
    setStatus({ kind: "idle" });
  }

  function add() {
    if (!current) return;
    const name = current;
    setRows((prev) => [...prev, { name, pipeline: null }]);
    setSelected("");
    setStatus({ kind: "idle" });
    // デモでは GitHub に問い合わせない
    if (demo) return;
    void checkPipeline(name).then((pipeline) => {
      setRows((prev) => prev.map((row) => (row.name === name ? { ...row, pipeline } : row)));
    });
  }

  function save() {
    setStatus({ kind: "idle" });
    if (demo) {
      demo.notify();
      return;
    }
    startSaving(async () => {
      const result = await saveWatchedRepos(rows.map((row) => row.name));
      setStatus(result.ok ? { kind: "saved" } : { kind: "error", message: result.message });
    });
  }

  return (
    <div>
      <ul className={styles.list}>
        {rows.map((row) => (
          <li key={row.name} className={styles.row}>
            <span className={`${styles.name} mono`}>{row.name}</span>
            {row.pipeline !== null && (
              <span className={styles.pipeline} data-pipeline={row.pipeline ? "yes" : "no"}>
                {row.pipeline ? "パイプラインあり" : "パイプラインなし"}
              </span>
            )}
            {editable && (
              <button
                type="button"
                className={styles.remove}
                onClick={() => remove(row.name)}
                disabled={saving}
              >
                外す
              </button>
            )}
          </li>
        ))}
      </ul>

      {editable && (
        <>
          <div className={styles.add}>
            <select
              className={`${styles.select} mono`}
              aria-label="追加するリポジトリ"
              value={current}
              onChange={(event) => setSelected(event.target.value)}
              disabled={saving || choices.length === 0}
            >
              {choices.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            <button
              type="button"
              className={settingsStyles.button}
              onClick={add}
              disabled={saving || !current}
            >
              追加
            </button>
          </div>

          <div className={settingsStyles.save}>
            <button
              type="button"
              className={settingsStyles.button}
              onClick={save}
              disabled={saving}
              aria-busy={saving}
            >
              {saving ? "保存中…" : "保存"}
            </button>
            {status.kind === "saved" && (
              <span className={settingsStyles.saved} role="status">
                保存しました
              </span>
            )}
            {status.kind === "error" && (
              <span className={settingsStyles.error} role="alert">
                {status.message}
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
