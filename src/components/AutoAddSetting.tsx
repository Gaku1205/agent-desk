"use client";

import { useState, useTransition } from "react";
import { saveAutoAdd, type SaveReposResult } from "@/app/(app)/settings/actions";
import { ACTION_UNREACHABLE_MESSAGE, callAction } from "@/lib/actionCall";
import { planAutoAddWrite, settleSave } from "@/lib/settingsSave";
import { useDemo } from "./DemoContext";
import { SettingsRow, useMarkSaved } from "./SettingsRow";
import { Switch } from "./Switch";

/**
 * 設定画面の `Auto-add`（スイッチ。初期はオン）。押したらすぐ `AGENT_DESK_AUTO_ADD` に保存する
 * （サーバー側。デモでは保存せず、サンプルの動きだけを変える）
 */
export function AutoAddSetting({ initialEnabled }: { initialEnabled: boolean }) {
  const demo = useDemo();
  const [own, setOwn] = useState(initialEnabled);
  const enabled = demo ? demo.autoAdd : own;
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  const markSaved = useMarkSaved();

  function toggle(next: boolean) {
    setError(null);
    if (demo) {
      demo.setAutoAdd(next);
      return;
    }
    const plan = planAutoAddWrite(next);
    if (!plan.ok) {
      setError(plan.message);
      return;
    }
    const before = own;
    setOwn(next);
    startSaving(async () => {
      const result = await callAction<SaveReposResult>(
        () => saveAutoAdd(plan.write.on),
        () => ({ ok: false, message: ACTION_UNREACHABLE_MESSAGE }),
      );
      setOwn(settleSave(before, next, result.ok));
      if (result.ok) markSaved();
      else setError(result.message);
    });
  }

  return (
    <SettingsRow
      name="Auto-add"
      description={<span title="外したリポジトリは足し直しません">新しいサービスを自動で監視に足す</span>}
      busy={saving}
      error={error}
    >
      <Switch checked={enabled} onChange={toggle} label="Auto-add" disabled={saving} />
    </SettingsRow>
  );
}
