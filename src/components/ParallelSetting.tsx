"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react";
import { saveParallel, type SaveReposResult } from "@/app/(app)/settings/actions";
import { ACTION_UNREACHABLE_MESSAGE, callAction } from "@/lib/actionCall";
import { isNightHour, type ParallelSettings } from "@/lib/parallel";
import {
  canStep,
  describeParallelSummary,
  dueSave,
  needsParallelSave,
  pickNightHour,
  planParallelWrite,
  queueSave,
  SAVE_DELAY_MS,
  settleSave,
  stepCount,
  type PendingSave,
} from "@/lib/settingsSave";
import { useDemo } from "./DemoContext";
import { broadcastParallelSettings, useParallelSaved } from "./ParallelContext";
import styles from "./Settings.module.css";
import { SettingsPanel, SettingsRow, useMarkSaved } from "./SettingsRow";

type RowKey = "day" | "night" | "hours";

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const SCALE = [0, 6, 12, 18, 24];

/** 1分ごとに変わる「いま」。サーバーでの描画では null（時刻で表示がずれないように、描いたあとで出す） */
function subscribeMinute(onChange: () => void): () => void {
  const timer = window.setInterval(onChange, 60_000);
  return () => window.clearInterval(timer);
}
function minuteNow(): number {
  return Math.floor(Date.now() / 60_000);
}

/** `−` 数 `＋` の段階ボタン */
function Stepper({
  value,
  onChange,
  name,
  disabled,
}: {
  value: number;
  onChange: (next: number) => void;
  name: string;
  disabled: boolean;
}) {
  return (
    <div className={styles.stepper}>
      <button
        type="button"
        className={styles.step}
        aria-label={`${name}を減らす`}
        disabled={disabled || !canStep(value, -1)}
        onClick={() => onChange(stepCount(value, -1))}
      >
        −
      </button>
      <span className={`${styles.stepValue} num`} aria-live="polite">
        {value}
      </span>
      <button
        type="button"
        className={styles.step}
        aria-label={`${name}を増やす`}
        disabled={disabled || !canStep(value, 1)}
        onClick={() => onChange(stepCount(value, 1))}
      >
        ＋
      </button>
    </div>
  );
}

/** 24時間の帯：ますを2回押して、夜の始まりと終わりを選ぶ */
function NightBand({
  settings,
  anchor,
  onPick,
  onCancel,
  disabled,
}: {
  settings: ParallelSettings;
  anchor: number | null;
  onPick: (hour: number) => void;
  onCancel: () => void;
  disabled: boolean;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const focusHour = anchor ?? settings.nightHours?.start ?? 0;

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, hour: number) {
    if (event.key === "Escape" && anchor !== null) {
      event.preventDefault();
      onCancel();
      return;
    }
    const delta = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (delta === 0) return;
    event.preventDefault();
    refs.current[(hour + delta + 24) % 24]?.focus();
  }

  return (
    <div>
      <div className={styles.band} role="group" aria-label="夜の時間帯（1時間ずつ）">
        {HOURS.map((hour) => {
          const night = isNightHour(hour, settings.nightHours);
          return (
            <button
              key={hour}
              ref={(el) => {
                refs.current[hour] = el;
              }}
              type="button"
              className={styles.cell}
              data-night={night ? "" : undefined}
              data-anchor={anchor === hour ? "" : undefined}
              aria-pressed={night}
              aria-label={`${hour}時`}
              tabIndex={hour === focusHour ? 0 : -1}
              disabled={disabled}
              onClick={() => onPick(hour)}
              onKeyDown={(event) => onKeyDown(event, hour)}
            />
          );
        })}
      </div>
      <div className={`${styles.scale} num`} aria-hidden="true">
        {SCALE.map((hour) => (
          <span key={hour} style={{ left: `${(hour / 24) * 100}%` }} data-edge={hour === 0 ? "start" : hour === 24 ? "end" : undefined}>
            {hour}
          </span>
        ))}
      </div>
      {anchor !== null && (
        <p className={styles.bandHint} role="status">
          終わりの時刻のますを押してください
        </p>
      )}
    </div>
  );
}

/** 「Parallel」の白い面。段階ボタン・帯は、最後に押してから600ms止まったら保存する（パイプラインのある監視リポジトリ全部に書く） */
export function ParallelSetting({ initial }: { initial: ParallelSettings }) {
  const [saved, setSaved] = useState(initial);
  const [draft, setDraft] = useState(initial);
  const [anchor, setAnchor] = useState<number | null>(null);
  const [error, setError] = useState<{ row: RowKey; message: string } | null>(null);
  const [busyRow, setBusyRow] = useState<RowKey | null>(null);
  const demo = useDemo();
  const applySaved = useParallelSaved();
  const markSaved = useMarkSaved();
  const minute = useSyncExternalStore(subscribeMinute, minuteNow, () => null);

  // 待っている保存と、最後に押した行。タイマーの中から最新を読むので ref に置く
  const pending = useRef<PendingSave<ParallelSettings> | null>(null);
  const lastRow = useRef<RowKey>("day");
  const savedRef = useRef(initial);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    savedRef.current = saved;
  }, [saved]);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  async function flush() {
    timer.current = null;
    const now = Date.now();
    const value = dueSave(pending.current, now);
    if (value === null) {
      // まだ止まっていなければ、残りの時間だけ待ち直す
      if (pending.current) timer.current = window.setTimeout(flush, pending.current.dueAt - now);
      return;
    }
    pending.current = null;
    const row = lastRow.current;
    const before = savedRef.current;
    if (!needsParallelSave(before, value)) return;
    const plan = planParallelWrite(value);
    if (!plan.ok) {
      setDraft(before);
      setError({ row, message: plan.message });
      return;
    }
    if (demo) {
      // デモでは書き込まず、画面の上の値だけ変える
      setSaved(plan.write.settings);
      demo.notify();
      return;
    }
    setBusyRow(row);
    const result = await callAction<SaveReposResult>(
      () => saveParallel(plan.write.settings),
      () => ({ ok: false, message: ACTION_UNREACHABLE_MESSAGE }),
    );
    setBusyRow(null);
    const next = settleSave(before, plan.write.settings, result.ok);
    setSaved(next);
    savedRef.current = next;
    if (result.ok) {
      applySaved?.(plan.write.settings);
      broadcastParallelSettings(plan.write.settings);
      markSaved();
      return;
    }
    // 失敗したら保存済みの値に戻す（そのあと押した分が待っていれば、それは残す）
    if (!pending.current) setDraft(before);
    setError({ row, message: result.message });
  }

  function change(next: ParallelSettings, row: RowKey) {
    setDraft(next);
    setError(null);
    lastRow.current = row;
    pending.current = queueSave(next, Date.now());
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void flush(), SAVE_DELAY_MS);
  }

  function pick(hour: number) {
    const result = pickNightHour(anchor, hour);
    if (result.kind === "anchor") {
      setAnchor(result.anchor);
      setError(null);
      return;
    }
    setAnchor(null);
    if (result.kind === "error") {
      setError({ row: "hours", message: result.message });
      return;
    }
    change({ ...draft, nightHours: result.hours }, "hours");
  }

  const now = demo ? demo.now : minute === null ? null : new Date(minute * 60_000);
  const summary = now ? describeParallelSummary(now, saved) : null;
  const busy = busyRow !== null;

  return (
    <SettingsPanel>
      <SettingsRow
        kind="summary"
        name={<span className={styles.summaryHead}>{summary?.headline ?? " "}</span>}
        description={summary ? <span className="num">{summary.detail}</span> : " "}
      >
        {summary && (
          <span className={`${styles.badge} num`} data-period={summary.badge.startsWith("Night") ? "night" : "day"}>
            {summary.badge}
          </span>
        )}
      </SettingsRow>
      <SettingsRow
        name="Day"
        description="昼に同時に進める数"
        busy={busyRow === "day"}
        error={error?.row === "day" ? error.message : null}
      >
        <Stepper
          name="昼の数"
          value={draft.day}
          disabled={busy}
          onChange={(day) => change({ ...draft, day }, "day")}
        />
      </SettingsRow>
      <SettingsRow
        name="Night"
        description="夜に同時に進める数"
        busy={busyRow === "night"}
        error={error?.row === "night" ? error.message : null}
      >
        <Stepper
          name="夜の数"
          value={draft.night}
          disabled={busy}
          onChange={(night) => change({ ...draft, night }, "night")}
        />
      </SettingsRow>
      <SettingsRow
        kind="hours"
        name="Night hours"
        description="夜の時間帯（日本時間）。ますを押して、始まりと終わりを選びます"
        busy={busyRow === "hours"}
        error={error?.row === "hours" ? error.message : null}
        below={
          <NightBand
            settings={draft}
            anchor={anchor}
            onPick={pick}
            onCancel={() => setAnchor(null)}
            disabled={busy}
          />
        }
      >
        <button
          type="button"
          className={styles.textButton}
          disabled={busy || draft.nightHours === null}
          onClick={() => {
            setAnchor(null);
            change({ ...draft, nightHours: null }, "hours");
          }}
        >
          夜なし
        </button>
      </SettingsRow>
    </SettingsPanel>
  );
}
