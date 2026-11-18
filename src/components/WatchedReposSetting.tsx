"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { checkPipeline, saveWatchedRepos, type SaveReposResult } from "@/app/(app)/settings/actions";
import { ACTION_UNREACHABLE_MESSAGE, callAction } from "@/lib/actionCall";
import { planWatchedReposWrite } from "@/lib/settingsSave";
import { AutoAddSetting } from "./AutoAddSetting";
import { useDemo } from "./DemoContext";
import { CheckIcon, CrossIcon, PlusIcon, RepoIcon } from "./icons";
import { broadcastSavedRepos, useApplySavedRepos } from "./NavContext";
import { Select } from "./Select";
import styles from "./Settings.module.css";
import { SettingsPanel, SettingsRow, useMarkSaved } from "./SettingsRow";

export type WatchedRepoRow = {
  /** `owner/repo` */
  name: string;
  /** パイプラインがあるか。まだ調べていなければ null */
  pipeline: boolean | null;
};

/** 畳んでいる間に出す件数 */
const SHOWN_ROWS = 5;

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
  /** `Auto-add` のオン・オフ。保存先が無いときは null で、行を出さない */
  autoAdd?: boolean | null;
};

/** 「Repositories」の白い面。「外す」「追加」を押したらすぐ保存する（サーバー側の Server Action） */
export function WatchedReposSetting({
  initialRows,
  options,
  editable,
  optionsError = null,
  onListChange,
  autoAdd = null,
}: Props) {
  const [rows, setRows] = useState(initialRows);
  const [expanded, setExpanded] = useState(false);
  const removeRefs = useRef(new Map<string, HTMLButtonElement>());
  const selectRef = useRef<HTMLButtonElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  // 「外す」を押したあとにフォーカスを移す先（行の名前。null は追加の選択欄）。描き直したあとで移す
  const pendingFocus = useRef<{ name: string | null } | null>(null);
  const [selected, setSelected] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  const demo = useDemo();
  const applySavedRepos = useApplySavedRepos();
  const markSaved = useMarkSaved();

  const listed = new Set(rows.map((row) => row.name.toLowerCase()));
  const choices = options.filter((name) => !listed.has(name.toLowerCase()));
  const current = choices.includes(selected) ? selected : (choices[0] ?? "");
  const folded = !expanded && rows.length > SHOWN_ROWS;
  const shown = folded ? rows.slice(0, SHOWN_ROWS) : rows;

  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    pendingFocus.current = null;
    const button = target.name === null ? null : removeRefs.current.get(target.name);
    const select = selectRef.current;
    (button ?? (select && !select.disabled ? select : addRef.current))?.focus();
  }, [rows]);

  /** 新しい一覧をすぐ保存する。0件などで受け付けなければ false（一覧は変えない） */
  function commit(next: WatchedRepoRow[]): boolean {
    const names = next.map((row) => row.name);
    const plan = planWatchedReposWrite(names);
    if (!plan.ok) {
      setError(plan.message);
      return false;
    }
    const before = rows;
    setRows(next);
    onListChange?.(names);
    setError(null);
    if (demo) {
      demo.notify();
      return true;
    }
    startSaving(async () => {
      const result = await callAction<SaveReposResult>(
        () => saveWatchedRepos(plan.write.names),
        () => ({ ok: false, message: ACTION_UNREACHABLE_MESSAGE }),
      );
      if (result.ok) {
        // 上端の帯・メニューの札は、取り直しを待たずに、保存した一覧にする（別タブにも知らせる）
        applySavedRepos?.(plan.write.names);
        broadcastSavedRepos(plan.write.names);
        markSaved();
        return;
      }
      // 失敗したら押す前の一覧に戻す
      setRows(before);
      onListChange?.(before.map((row) => row.name));
      setError(result.message);
    });
    return true;
  }

  function remove(name: string) {
    const index = rows.findIndex((row) => row.name === name);
    const nextName = rows[index + 1]?.name ?? null;
    if (commit(rows.filter((row) => row.name !== name))) pendingFocus.current = { name: nextName };
  }

  function add() {
    if (!current) return;
    const name = current;
    if (!commit([...rows, { name, pipeline: null }])) return;
    setSelected("");
    // デモでは GitHub に問い合わせない
    if (demo) return;
    void checkPipeline(name)
      .then((pipeline) => {
        setRows((prev) => prev.map((row) => (row.name === name ? { ...row, pipeline } : row)));
      })
      // 調べられなかった（呼び出しが届かなかった）ときは、パイプラインの有無を出さないまま
      .catch(() => undefined);
  }

  return (
    <div>
      <SettingsPanel>
        {shown.map((row) => (
          <SettingsRow
            key={row.name}
            kind="repo"
            icon={<RepoIcon />}
            name={
              <span className={styles.repoName} title={row.name}>
                {row.name}
              </span>
            }
            busy={saving}
          >
            {row.pipeline === true && (
              <span className={styles.pipeline}>
                Pipeline
                <CheckIcon />
              </span>
            )}
            {row.pipeline === false && <span className={styles.noPipeline}>パイプラインなし</span>}
            {editable && (
              <button
                type="button"
                className={styles.textButton}
                aria-label={`${row.name} を外す`}
                ref={(el) => {
                  if (el) removeRefs.current.set(row.name, el);
                  else removeRefs.current.delete(row.name);
                }}
                onClick={() => remove(row.name)}
                disabled={saving}
              >
                <CrossIcon size={14} />
                外す
              </button>
            )}
          </SettingsRow>
        ))}

        {rows.length > SHOWN_ROWS && (
          <SettingsRow
            kind="more"
            name={<span className={`${styles.more} num`}>ほか {rows.length - SHOWN_ROWS}件</span>}
          >
            <button
              type="button"
              className={styles.textButton}
              aria-expanded={!folded}
              onClick={() => setExpanded((open) => !open)}
            >
              {folded ? "すべて見る" : "たたむ"}
            </button>
          </SettingsRow>
        )}

        {editable && (
          <SettingsRow
            kind="add"
            icon={<PlusIcon />}
            name="リポジトリを追加"
            busy={saving}
            error={optionsError ? `リポジトリの一覧を取れませんでした：${optionsError}` : null}
          >
            <Select
              label="追加するリポジトリ"
              options={choices}
              value={current}
              onChange={setSelected}
              disabled={saving}
              buttonRef={selectRef}
              emptyText={optionsError ? "（取得できませんでした）" : undefined}
              icon={<RepoIcon />}
              className={styles.select}
            />
            <button
              type="button"
              className={styles.addButton}
              ref={addRef}
              onClick={add}
              disabled={saving || !current}
            >
              追加
            </button>
          </SettingsRow>
        )}

        {autoAdd !== null && <AutoAddSetting initialEnabled={autoAdd} />}
      </SettingsPanel>
      {error && (
        <p className={styles.panelError} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
