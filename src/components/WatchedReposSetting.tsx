"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { checkPipeline, saveWatchedRepos } from "@/app/(app)/settings/actions";
import { useDemo } from "./DemoContext";
import { Select } from "./Select";
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
  /** 追加の欄の一覧が取れなかったときの理由。取れたときは null */
  optionsError?: string | null;
  /** 一覧が変わるたびに、いまのリポジトリ名（`owner/repo`）を知らせる */
  onListChange?: (names: string[]) => void;
};

type Status = { kind: "idle" } | { kind: "saved" } | { kind: "error"; message: string };

/** 設定画面の「監視するリポジトリ」。保存はサーバー側（Server Action）で行う */
export function WatchedReposSetting({
  initialRows,
  options,
  editable,
  optionsError = null,
  onListChange,
}: Props) {
  const [rows, setRows] = useState(initialRows);
  // 最後に保存した（または読み込んだ）一覧。未保存かどうかは、これとの差で決める
  const [savedNames, setSavedNames] = useState(() => initialRows.map((row) => row.name));
  const removeRefs = useRef(new Map<string, HTMLButtonElement>());
  const selectRef = useRef<HTMLButtonElement>(null);
  const saveRef = useRef<HTMLButtonElement>(null);
  // 「外す」を押したあとにフォーカスを移す先（行の名前。null は追加の選択欄）。描き直したあとで移す
  const pendingFocus = useRef<{ name: string | null } | null>(null);
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
  const savedSet = new Set(savedNames);
  const dirty = rows.length !== savedSet.size || rows.some((row) => !savedSet.has(row.name));

  // 未保存のままリロード・タブを閉じようとしたら、ブラウザ標準の確認を出す（デモでは出さない）
  useEffect(() => {
    if (!dirty || demo) return;
    function onBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty, demo]);

  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    pendingFocus.current = null;
    const button = target.name === null ? null : removeRefs.current.get(target.name);
    const select = selectRef.current;
    (button ?? (select && !select.disabled ? select : saveRef.current))?.focus();
  }, [rows]);

  function remove(name: string) {
    const index = rows.findIndex((row) => row.name === name);
    pendingFocus.current = { name: rows[index + 1]?.name ?? null };
    const next = rows.filter((row) => row.name !== name);
    setRows(next);
    onListChange?.(next.map((row) => row.name));
    setStatus({ kind: "idle" });
  }

  function add() {
    if (!current) return;
    const name = current;
    setRows((prev) => [...prev, { name, pipeline: null }]);
    onListChange?.([...rows.map((row) => row.name), name]);
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
      const names = rows.map((row) => row.name);
      const result = await saveWatchedRepos(names);
      if (result.ok) setSavedNames(names);
      setStatus(result.ok ? { kind: "saved" } : { kind: "error", message: result.message });
    });
  }

  return (
    <div>
      <ul className={styles.list}>
        {rows.map((row) => (
          <li key={row.name} className={styles.row}>
            <span className={styles.name}>{row.name}</span>
            {row.pipeline !== null && (
              <span className={styles.pipeline} data-pipeline={row.pipeline ? "yes" : "no"}>
                {row.pipeline ? "パイプラインあり" : "パイプラインなし"}
              </span>
            )}
            {editable && (
              <button
                type="button"
                className={styles.remove}
                aria-label={`${row.name} を外す`}
                ref={(el) => {
                  if (el) removeRefs.current.set(row.name, el);
                  else removeRefs.current.delete(row.name);
                }}
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
            <Select
              label="追加するリポジトリ"
              options={choices}
              value={current}
              onChange={setSelected}
              disabled={saving}
              buttonRef={selectRef}
              emptyText={optionsError ? "（取得できませんでした）" : undefined}
            />
            <button
              type="button"
              className={settingsStyles.textButton}
              onClick={add}
              disabled={saving || !current}
            >
              追加
            </button>
          </div>

          {optionsError && (
            <p className={styles.optionsError} role="alert">
              リポジトリの一覧を取れませんでした：{optionsError}
            </p>
          )}

          <div className={settingsStyles.save}>
            <button
              type="button"
              className={settingsStyles.button}
              ref={saveRef}
              onClick={save}
              disabled={saving}
              aria-busy={saving}
            >
              {saving ? "保存中…" : "リポジトリを保存"}
            </button>
            {dirty && !saving && <span className={settingsStyles.unsaved}>未保存</span>}
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
