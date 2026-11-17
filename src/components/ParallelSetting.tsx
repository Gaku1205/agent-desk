"use client";

import { useEffect, useState, useSyncExternalStore, useTransition } from "react";
import { saveParallel, type SaveReposResult } from "@/app/(app)/settings/actions";
import { ACTION_UNREACHABLE_MESSAGE, callAction } from "@/lib/actionCall";
import {
  checkParallelSettings,
  describeParallelNow,
  PARALLEL_SELECT_MAX,
  sameParallelSettings,
  type ParallelSettings,
} from "@/lib/parallel";
import { useDemo } from "./DemoContext";
import { SaveIcon } from "./icons";
import styles from "./ParallelSetting.module.css";
import { Select } from "./Select";
import settingsStyles from "./SettingsSections.module.css";

type Status = { kind: "idle" } | { kind: "saved" } | { kind: "error"; message: string };

const NO_NIGHT = "無し";
const HOUR_LABELS = Array.from({ length: 24 }, (_, hour) => `${hour}時`);
const START_OPTIONS = [NO_NIGHT, ...HOUR_LABELS];
/** 夜の時間帯を「無し」から選び直したときの、終了時の初期値 */
const DEFAULT_END_HOUR = 8;

/** 選べる数（1〜10。いまの値がそれより大きければ、それも選べる） */
function countOptions(current: number): string[] {
  const max = Math.max(PARALLEL_SELECT_MAX, current);
  return Array.from({ length: max }, (_, i) => String(i + 1));
}

function parseHour(label: string): number | null {
  const hour = Number.parseInt(label, 10);
  return Number.isInteger(hour) ? hour : null;
}

/** 1分ごとに変わる「いま」。サーバーでの描画では null（時刻で表示がずれないように、描いたあとで出す） */
function subscribeMinute(onChange: () => void): () => void {
  const timer = window.setInterval(onChange, 60_000);
  return () => window.clearInterval(timer);
}
function minuteNow(): number {
  return Math.floor(Date.now() / 60_000);
}

/** 設定画面の「並列」。保存はサーバー側（Server Action）で行い、パイプラインのある監視リポジトリ全部に書く */
export function ParallelSetting({ initial }: { initial: ParallelSettings }) {
  const [saved, setSaved] = useState(initial);
  const [day, setDay] = useState(initial.day);
  const [night, setNight] = useState(initial.night);
  // 夜の時間帯：開始が null なら「無し」。終了は「無し」にしても覚えておく
  const [start, setStart] = useState<number | null>(initial.nightHours?.start ?? null);
  const [end, setEnd] = useState(initial.nightHours?.end ?? DEFAULT_END_HOUR);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [saving, startSaving] = useTransition();
  const demo = useDemo();
  const minute = useSyncExternalStore(subscribeMinute, minuteNow, () => null);

  const draft: ParallelSettings = {
    day,
    night,
    nightHours: start === null ? null : { start, end },
  };
  const dirty = !sameParallelSettings(draft, saved);

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
    if (status.kind !== "saved") return;
    const timer = window.setTimeout(() => setStatus({ kind: "idle" }), 2000);
    return () => window.clearTimeout(timer);
  }, [status]);

  function edit(change: () => void) {
    change();
    setStatus({ kind: "idle" });
  }

  function save() {
    setStatus({ kind: "idle" });
    if (demo) {
      demo.notify();
      return;
    }
    // サーバーと同じ確かめ（同じ時刻の開始と終了など）。通らなければ書き込まずに理由を出す
    const checked = checkParallelSettings(draft);
    if (!checked.ok) {
      setStatus({ kind: "error", message: checked.message });
      return;
    }
    startSaving(async () => {
      const result = await callAction<SaveReposResult>(
        () => saveParallel(checked.settings),
        () => ({ ok: false, message: ACTION_UNREACHABLE_MESSAGE }),
      );
      if (result.ok) setSaved(checked.settings);
      setStatus(result.ok ? { kind: "saved" } : { kind: "error", message: result.message });
    });
  }

  return (
    <div>
      <p className={styles.now}>
        {minute === null ? " " : describeParallelNow(new Date(minute * 60_000), saved)}
      </p>
      <div className={styles.rows}>
        <div className={styles.row}>
          <span className={styles.label}>昼の並列</span>
          <Select
            label="昼の並列"
            options={countOptions(day)}
            value={String(day)}
            onChange={(value) => edit(() => setDay(Number(value)))}
            disabled={saving}
          />
        </div>
        <div className={styles.row}>
          <span className={styles.label}>夜の並列</span>
          <Select
            label="夜の並列"
            options={countOptions(night)}
            value={String(night)}
            onChange={(value) => edit(() => setNight(Number(value)))}
            disabled={saving}
          />
        </div>
        <div className={styles.row}>
          <span className={styles.label}>夜の時間帯</span>
          <div className={styles.hours}>
            <Select
              label="夜の時間帯の開始"
              options={START_OPTIONS}
              value={start === null ? NO_NIGHT : HOUR_LABELS[start]}
              onChange={(value) => edit(() => setStart(parseHour(value)))}
              disabled={saving}
            />
            {start !== null && (
              <>
                <span className={styles.to}>から</span>
                <Select
                  label="夜の時間帯の終了"
                  options={HOUR_LABELS}
                  value={HOUR_LABELS[end]}
                  onChange={(value) => edit(() => setEnd(parseHour(value) ?? end))}
                  disabled={saving}
                />
                <span className={styles.to}>まで</span>
              </>
            )}
          </div>
        </div>
      </div>
      <p className={styles.hint}>
        夜の時間帯の外は昼の数、中は夜の数で動きます（基準は日本時間。終わりの時刻は含みません）。保存すると、パイプラインのある監視リポジトリ全部に書きます
      </p>
      <div className={settingsStyles.save}>
        <button
          type="button"
          className={settingsStyles.button}
          onClick={save}
          disabled={saving}
          aria-busy={saving}
        >
          <SaveIcon />
          {saving ? "保存中…" : "並列を保存"}
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
    </div>
  );
}
