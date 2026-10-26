"use client";

import { useEffect, useState, useTransition } from "react";
import { saveNotifyEvents } from "@/app/settings/actions";
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

function RepoNotify({ row }: { row: NotifyRepoRow }) {
  const [checked, setChecked] = useState<Set<NotifyEvent>>(new Set(row.events));
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [saving, startSaving] = useTransition();

  useEffect(() => {
    if (status.kind !== "saved") return;
    const timer = window.setTimeout(() => setStatus({ kind: "idle" }), 2000);
    return () => window.clearTimeout(timer);
  }, [status]);

  function toggle(kind: NotifyEvent) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
    setStatus({ kind: "idle" });
  }

  function save() {
    setStatus({ kind: "idle" });
    startSaving(async () => {
      const result = await saveNotifyEvents(
        row.name,
        NOTIFY_EVENT_KINDS.filter((kind) => checked.has(kind)),
      );
      setStatus(result.ok ? { kind: "saved" } : { kind: "error", message: result.message });
    });
  }

  const disabled = !row.pipeline;
  return (
    <div className="notify-repo">
      <h3 className="notify-repo-title mono">
        {row.name}
        {disabled && <span className="repo-setting-pipeline">パイプラインなし</span>}
      </h3>
      <ul className="notify-list">
        {NOTIFY_EVENT_KINDS.map((kind) => (
          <li key={kind}>
            <label className="notify-item" data-disabled={disabled || undefined}>
              <input
                type="checkbox"
                checked={checked.has(kind)}
                onChange={() => toggle(kind)}
                disabled={disabled || saving}
              />
              <span>
                <span className="notify-name">{NOTIFY_EVENT_LABELS[kind].name}</span>
                <span className="notify-desc">{NOTIFY_EVENT_LABELS[kind].description}</span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      {!disabled && (
        <div className="repo-setting-save">
          <button
            type="button"
            className="setting-button"
            onClick={save}
            disabled={saving}
            aria-busy={saving}
          >
            {saving ? "保存中…" : "保存"}
          </button>
          {status.kind === "saved" && (
            <span className="setting-saved" role="status">
              保存しました
            </span>
          )}
          {status.kind === "error" && (
            <span className="setting-error" role="alert">
              {status.message}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/** 設定画面の「通知」。リポジトリごとに鳴らす種類を選ぶ。保存はサーバー側（Server Action）で行う */
export function NotifySetting({ rows }: { rows: NotifyRepoRow[] }) {
  return (
    <div>
      {rows.map((row) => (
        <RepoNotify key={row.name} row={row} />
      ))}
    </div>
  );
}
