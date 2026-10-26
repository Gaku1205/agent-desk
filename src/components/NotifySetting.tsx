"use client";

import { useEffect, useState, useTransition } from "react";
import { saveNotifyEvents } from "@/app/(app)/settings/actions";
import { useDemo } from "./DemoContext";
import styles from "./NotifySetting.module.css";
import settingsStyles from "./SettingsSections.module.css";
import { changedRepos, formatSaveFailures, type NotifyDraft } from "@/lib/notifyChanges";
import {
  NOTIFY_EVENT_KINDS,
  NOTIFY_EVENT_LABELS,
  type NotifyEvent,
} from "@/lib/notifyEvents";

export type NotifyRepoRow = {
  /** `owner/repo` */
  name: string;
  /** パイプラインがあるか。無ければ選べない */
  pipeline: boolean;
  /** いま鳴らす種類（Variable が無ければ初期値） */
  events: NotifyEvent[];
};

type Status = { kind: "idle" } | { kind: "saved" } | { kind: "error"; message: string };

/** 列の見出し。`owner/` を省く */
function shortName(name: string): string {
  const slash = name.indexOf("/");
  return slash < 0 ? name : name.slice(slash + 1);
}

/** 設定画面の「通知」。縦が通知の種類、横がリポジトリの表。保存はサーバー側（Server Action）で行う */
export function NotifySetting({ rows }: { rows: NotifyRepoRow[] }) {
  const [current, setCurrent] = useState<Record<string, NotifyEvent[]>>(() =>
    Object.fromEntries(rows.map((row) => [row.name, row.events])),
  );
  const [saved, setSaved] = useState<Record<string, NotifyEvent[]>>(() =>
    Object.fromEntries(rows.map((row) => [row.name, row.events])),
  );
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [saving, startSaving] = useTransition();
  const demo = useDemo();

  useEffect(() => {
    if (status.kind !== "saved") return;
    const timer = window.setTimeout(() => setStatus({ kind: "idle" }), 2000);
    return () => window.clearTimeout(timer);
  }, [status]);

  function toggle(name: string, kind: NotifyEvent) {
    setCurrent((prev) => {
      const events = prev[name] ?? [];
      return {
        ...prev,
        [name]: events.includes(kind) ? events.filter((e) => e !== kind) : [...events, kind],
      };
    });
    setStatus({ kind: "idle" });
  }

  function save() {
    if (demo) {
      // デモでは何も書き込まず、動かないことを知らせる
      demo.notify();
      return;
    }
    const drafts: NotifyDraft[] = rows.map((row) => ({
      name: row.name,
      pipeline: row.pipeline,
      saved: saved[row.name] ?? [],
      current: current[row.name] ?? [],
    }));
    const targets = changedRepos(drafts);
    // 変更が無ければ何も書き込まない
    if (targets.length === 0) return;
    setStatus({ kind: "idle" });
    startSaving(async () => {
      const failures: { name: string; message: string }[] = [];
      const done: Record<string, NotifyEvent[]> = {};
      for (const target of targets) {
        const events = NOTIFY_EVENT_KINDS.filter((kind) => target.current.includes(kind));
        const result = await saveNotifyEvents(target.name, events);
        if (result.ok) done[target.name] = events;
        else failures.push({ name: target.name, message: result.message });
      }
      setSaved((prev) => ({ ...prev, ...done }));
      setStatus(
        failures.length === 0
          ? { kind: "saved" }
          : { kind: "error", message: formatSaveFailures(failures, targets.length) },
      );
    });
  }

  if (rows.length === 0) return null;

  return (
    <div>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col" className={styles.kindHead} aria-label="通知の種類" />
              {rows.map((row) => (
                <th key={row.name} scope="col" className={styles.repoHead}>
                  <span className={`${styles.repoName} mono`} title={row.name}>
                    {shortName(row.name)}
                  </span>
                  {!row.pipeline && <span className={styles.noPipeline}>パイプラインなし</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {NOTIFY_EVENT_KINDS.map((kind) => (
              <tr key={kind}>
                <th scope="row" className={styles.kind}>
                  <span className={styles.name}>{NOTIFY_EVENT_LABELS[kind].name}</span>
                  <span className={styles.desc}>{NOTIFY_EVENT_LABELS[kind].description}</span>
                </th>
                {rows.map((row) => (
                  <td key={row.name} className={styles.cell}>
                    <input
                      type="checkbox"
                      checked={(current[row.name] ?? []).includes(kind)}
                      onChange={() => toggle(row.name, kind)}
                      disabled={!row.pipeline || saving}
                      aria-label={`${NOTIFY_EVENT_LABELS[kind].name}（${row.name}）`}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
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
    </div>
  );
}
