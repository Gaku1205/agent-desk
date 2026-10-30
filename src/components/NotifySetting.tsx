"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { saveNotifyEvents } from "@/app/(app)/settings/actions";
import { useDemo } from "./DemoContext";
import styles from "./NotifySetting.module.css";
import settingsStyles from "./SettingsSections.module.css";
import { changedRepos, formatSaveFailures } from "@/lib/notifyChanges";
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

type Status =
  | { kind: "idle" }
  | { kind: "saved" }
  | { kind: "unchanged" }
  | { kind: "error"; message: string };

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
  // 表が横に流れるとき、右にまだ続くか（スマホで、横に動かせる手がかりを出す）
  const wrapRef = useRef<HTMLDivElement>(null);
  const [moreRight, setMoreRight] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const measure = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    setMoreRight(el.scrollWidth - el.clientWidth - el.scrollLeft > 4);
    setScrolled(el.scrollLeft > 0);
  }, []);

  useEffect(() => {
    measure();
    const el = wrapRef.current;
    if (!el) return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    return () => observer.disconnect();
  }, [measure, rows.length]);

  // 保存済みの種類との差があるリポジトリ（パイプラインが無い列は除く）
  const targets = changedRepos(
    rows.map((row) => ({
      name: row.name,
      pipeline: row.pipeline,
      saved: saved[row.name] ?? [],
      current: current[row.name] ?? [],
    })),
  );
  const dirty = targets.length > 0;

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
    if (status.kind !== "saved" && status.kind !== "unchanged") return;
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
    // 変更が無ければ何も書き込まず、そう知らせる
    if (targets.length === 0) {
      setStatus({ kind: "unchanged" });
      return;
    }
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

  if (rows.length === 0) {
    return (
      <p className={styles.empty}>
        監視するリポジトリがありません。上で追加して保存すると、ここで通知を選べます
      </p>
    );
  }

  return (
    <div>
      {moreRight && <p className={styles.scrollHint}>横に動かすと、ほかのリポジトリが見えます</p>}
      <div
        className={styles.tableWrap}
        ref={wrapRef}
        data-more-right={moreRight ? "" : undefined}
        data-scrolled={scrolled ? "" : undefined}
        onScroll={measure}
      >
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col" className={styles.kindHead} aria-label="通知の種類" />
              {rows.map((row) => (
                <th key={row.name} scope="col" className={styles.repoHead}>
                  <span className={styles.repoName} title={row.name}>
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
                {rows.map((row) => {
                  const on = (current[row.name] ?? []).includes(kind);
                  const disabled = !row.pipeline || saving;
                  return (
                    <td key={row.name} className={styles.cell}>
                      {/* 標準のチェックボックスは見えなくして残し（キーボード・読み上げ）、ランプと字を描く */}
                      <label
                        className={settingsStyles.toggle}
                        data-on={on ? "" : undefined}
                        data-disabled={disabled ? "" : undefined}
                      >
                        <input
                          type="checkbox"
                          className={settingsStyles.native}
                          checked={on}
                          onChange={() => toggle(row.name, kind)}
                          disabled={disabled}
                          aria-label={`${NOTIFY_EVENT_LABELS[kind].name}（${row.name}）`}
                        />
                        <span className={settingsStyles.lamp} aria-hidden="true" />
                        <span aria-hidden="true">{on ? "オン" : "オフ"}</span>
                      </label>
                    </td>
                  );
                })}
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
          {saving ? "保存中…" : "通知を保存"}
        </button>
        {dirty && !saving && <span className={settingsStyles.unsaved}>未保存</span>}
        {status.kind === "unchanged" && (
          <span className={settingsStyles.unchanged} role="status">
            変更はありません
          </span>
        )}
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
