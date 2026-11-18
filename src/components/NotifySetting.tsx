"use client";

import { useState, useTransition } from "react";
import { saveNotifyEvents, type SaveReposResult } from "@/app/(app)/settings/actions";
import { ACTION_UNREACHABLE_MESSAGE, callAction } from "@/lib/actionCall";
import { formatSaveFailures } from "@/lib/notifyChanges";
import type { NotifyEvent } from "@/lib/notifyEvents";
import {
  NOTIFY_ROWS,
  notifyRowOn,
  notifyScopeLabel,
  planNotifyWrites,
  repoHasRow,
  revertNotifyFailures,
  setNotifyRepo,
  setNotifyRow,
  type NotifyRepo,
  type NotifyRowKey,
} from "@/lib/settingsSave";
import { useDemo } from "./DemoContext";
import { CheckIcon } from "./icons";
import styles from "./Settings.module.css";
import { SettingsPanel, SettingsRow, useMarkSaved } from "./SettingsRow";
import { Switch } from "./Switch";

export type NotifyRepoRow = {
  /** `owner/repo` */
  name: string;
  /** パイプラインがあるか。無ければ対象外 */
  pipeline: boolean;
  /** いま鳴らす種類（Variable が無ければ初期値） */
  events: NotifyEvent[];
};

/** 札の名前。`owner/` を省く */
function shortName(name: string): string {
  const slash = name.indexOf("/");
  return slash < 0 ? name : name.slice(slash + 1);
}

/**
 * 「Notifications」の白い面：1行1種類のスイッチ（全部のリポジトリに効く）と、リポジトリごとに外せる札。
 * 押したらすぐ、値が変わったリポジトリの `NOTIFY_EVENTS` に書く（サーバー側の Server Action）
 */
export function NotifySetting({ rows }: { rows: NotifyRepoRow[] }) {
  // 押して変えた値（リポジトリ名ごと）。無いリポジトリは、サーバーから来た値のまま
  const [changed, setChanged] = useState<Record<string, readonly NotifyEvent[]>>({});
  const [open, setOpen] = useState<ReadonlySet<NotifyRowKey>>(new Set());
  const [errors, setErrors] = useState<Partial<Record<NotifyRowKey, string>>>({});
  const [busyRow, setBusyRow] = useState<NotifyRowKey | null>(null);
  const [, startSaving] = useTransition();
  const demo = useDemo();
  const markSaved = useMarkSaved();

  const repos: NotifyRepo[] = rows.map((row) => ({ ...row, events: changed[row.name] ?? row.events }));
  const targets = repos.filter((repo) => repo.pipeline);

  function apply(next: readonly NotifyRepo[]) {
    setChanged((prev) => ({ ...prev, ...Object.fromEntries(next.map((repo) => [repo.name, repo.events])) }));
  }

  function commit(key: NotifyRowKey, after: NotifyRepo[]) {
    const plan = planNotifyWrites(repos, after);
    if (!plan.ok) {
      setErrors((prev) => ({ ...prev, [key]: plan.message }));
      return;
    }
    setErrors((prev) => ({ ...prev, [key]: undefined }));
    if (plan.write.length === 0) return;
    const before = repos;
    apply(after);
    if (demo) {
      demo.notify();
      return;
    }
    setBusyRow(key);
    startSaving(async () => {
      const failures: { name: string; message: string }[] = [];
      for (const write of plan.write) {
        const result = await callAction<SaveReposResult>(
          () => saveNotifyEvents(write.where, write.events),
          () => ({ ok: false, message: ACTION_UNREACHABLE_MESSAGE }),
        );
        if (!result.ok) failures.push({ name: write.where, message: result.message });
      }
      setBusyRow(null);
      if (failures.length === 0) {
        markSaved();
        return;
      }
      apply(revertNotifyFailures(before, after, failures.map((failure) => failure.name)));
      setErrors((prev) => ({ ...prev, [key]: formatSaveFailures(failures, plan.write.length) }));
    });
  }

  function toggleOpen(key: NotifyRowKey) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  if (targets.length === 0) {
    return (
      <p className={styles.empty}>
        パイプラインのある監視リポジトリがありません。Repositories で追加すると、ここで通知を選べます
      </p>
    );
  }

  return (
    <SettingsPanel>
      {NOTIFY_ROWS.map((row) => {
        const on = notifyRowOn(repos, row.key);
        const expanded = on && open.has(row.key);
        const busy = busyRow === row.key;
        const disabled = busyRow !== null;
        const listId = `notify-${row.key}-repos`;
        return (
          <SettingsRow
            key={row.key}
            name={row.name}
            description={row.description}
            busy={busy}
            error={errors[row.key] ?? null}
            below={
              expanded ? (
                <ul className={styles.chips} id={listId} aria-label={`${row.name} を鳴らすリポジトリ`}>
                  {targets.map((repo) => {
                    const pressed = repoHasRow(repo, row.key);
                    return (
                      <li key={repo.name}>
                        <button
                          type="button"
                          className={styles.chip}
                          aria-pressed={pressed}
                          title={repo.name}
                          disabled={disabled}
                          onClick={() => commit(row.key, setNotifyRepo(repos, row.key, repo.name, !pressed))}
                        >
                          {pressed && <CheckIcon />}
                          {shortName(repo.name)}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : undefined
            }
          >
            {on && (
              <button
                type="button"
                className={styles.scope}
                aria-expanded={expanded}
                aria-controls={expanded ? listId : undefined}
                aria-label={`${row.name} のリポジトリ（${notifyScopeLabel(repos, row.key)}）`}
                onClick={() => toggleOpen(row.key)}
              >
                <span className="num">{notifyScopeLabel(repos, row.key)}</span>
                <span className={styles.caret} aria-hidden="true">
                  ▾
                </span>
              </button>
            )}
            <Switch
              checked={on}
              label={row.name}
              disabled={disabled}
              onChange={(next) => commit(row.key, setNotifyRow(repos, row.key, next))}
            />
          </SettingsRow>
        );
      })}
    </SettingsPanel>
  );
}
