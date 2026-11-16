"use client";

import { useEffect, useState, useTransition } from "react";
import { saveAutoAdd, type SaveReposResult } from "@/app/(app)/settings/actions";
import { ACTION_UNREACHABLE_MESSAGE, callAction } from "@/lib/actionCall";
import { useDemo } from "./DemoContext";
import settingsStyles from "./SettingsSections.module.css";
import styles from "./AutoAddSetting.module.css";

type Status = { kind: "idle" } | { kind: "saved" } | { kind: "error"; message: string };

/**
 * 設定画面の「新しいサービスを自動で追加」（ランプ＋字のオン・オフ。初期はオン）。
 * 押したらすぐ保存する（サーバー側。デモでは保存せず、サンプルの動きだけを変える）
 */
export function AutoAddSetting({ initialEnabled }: { initialEnabled: boolean }) {
  const demo = useDemo();
  const [own, setOwn] = useState(initialEnabled);
  const enabled = demo ? demo.autoAdd : own;
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [saving, startSaving] = useTransition();

  useEffect(() => {
    if (status.kind !== "saved") return;
    const timer = window.setTimeout(() => setStatus({ kind: "idle" }), 2000);
    return () => window.clearTimeout(timer);
  }, [status]);

  function toggle() {
    const next = !enabled;
    setStatus({ kind: "idle" });
    if (demo) {
      demo.setAutoAdd(next);
      return;
    }
    setOwn(next);
    startSaving(async () => {
      const result = await callAction<SaveReposResult>(
        () => saveAutoAdd(next),
        () => ({ ok: false, message: ACTION_UNREACHABLE_MESSAGE }),
      );
      if (!result.ok) setOwn(!next);
      setStatus(result.ok ? { kind: "saved" } : { kind: "error", message: result.message });
    });
  }

  return (
    <div className={styles.row}>
      {/* 標準のチェックボックスは見えなくして残し（キーボード・読み上げ）、ランプと字を描く */}
      <label className={settingsStyles.toggle} data-on={enabled ? "" : undefined}>
        <input
          type="checkbox"
          className={settingsStyles.native}
          checked={enabled}
          onChange={toggle}
          disabled={saving}
          aria-label="新しいサービスを自動で追加"
        />
        <span className={settingsStyles.lamp} aria-hidden="true" />
        <span aria-hidden="true">新しいサービスを自動で追加</span>
      </label>
      <span className={styles.hint}>
        {enabled
          ? "テンプレートから作られたリポジトリを、自動で監視に足します。外した物は足し直しません"
          : "テンプレートから作られたリポジトリも、手で追加します"}
      </span>
      {saving && <span className={settingsStyles.saved}>保存中…</span>}
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
  );
}
