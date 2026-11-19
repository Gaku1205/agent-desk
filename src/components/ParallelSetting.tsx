"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent } from "react";
import { saveParallel, type SaveReposResult } from "@/app/(app)/settings/actions";
import { ACTION_UNREACHABLE_MESSAGE, callAction } from "@/lib/actionCall";
import { isNightHour, type ParallelSettings } from "@/lib/parallel";
import {
  changeNightEnd,
  changeNightStart,
  daySpans,
  describeParallelNow,
  endSelectValue,
  HOUR_OPTIONS,
  nightSpans,
  nowPosition,
  pickCountSpan,
  spanCenter,
  START_OPTIONS,
  startSelectValue,
  type SelectChange,
  type Span,
} from "@/lib/parallelBand";
import {
  canStep,
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
import { summarizeSaveFailures, type SaveFailureLine } from "@/lib/saveFailures";
import { useDemo } from "./DemoContext";
import { MoonIcon, SunIcon } from "./icons";
import { broadcastParallelSettings, useParallelSaved } from "./ParallelContext";
import { Select } from "./Select";
import styles from "./Settings.module.css";
import { SaveFailureLines, SettingsPanel, useMarkSaved, useReportFailure } from "./SettingsRow";

type RowKey = "day" | "night" | "hours";
const ROW_KEYS: readonly RowKey[] = ["day", "night", "hours"];

/** 別の行で同じ文が残っていても、1回だけ出す */
function uniqueLines(lines: readonly SaveFailureLine[]): SaveFailureLine[] {
  return lines.filter((line, index) => lines.findIndex((other) => other.text === line.text) === index);
}

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

/** `−` 数 `＋` の小さい段階ボタン */
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

/** 帯の上の件数：区間の真ん中あたりに置く（端でははみ出さず寄せる） */
function CountGroup({
  span,
  kind,
  value,
  onChange,
  disabled,
}: {
  span: Span;
  kind: "night" | "day";
  value: number;
  onChange: (next: number) => void;
  disabled: boolean;
}) {
  const center = spanCenter(span) * 100;
  const style: CSSProperties = { marginLeft: `${center}%`, transform: `translateX(-${center}%)` };
  return (
    <div className={styles.countGroup} style={style} data-kind={kind}>
      <span className={styles.countName}>
        {kind === "night" ? <MoonIcon size={14} /> : <SunIcon size={14} />}
        {kind === "night" ? "Night" : "Day"}
      </span>
      <Stepper name={kind === "night" ? "夜の数" : "昼の数"} value={value} disabled={disabled} onChange={onChange} />
    </div>
  );
}

/** 24時間の帯：ますを2回押して、夜の始まりと終わりを選ぶ。「今」の縦線と目盛り付き */
function NightBand({
  settings,
  anchor,
  position,
  onPick,
  onCancel,
  disabled,
}: {
  settings: ParallelSettings;
  anchor: number | null;
  /** 今の位置（0〜1）。まだ分からなければ null */
  position: number | null;
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
      <div className={styles.bandWrap}>
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
        {position !== null && (
          <span className={styles.nowMark} style={{ left: `${position * 100}%` }} aria-hidden="true" />
        )}
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

/** 「Parallel」の白い面。段階ボタン・帯・選択欄は、最後に変えてから600ms止まったら保存する（パイプラインのある監視リポジトリ全部に書く） */
export function ParallelSetting({ initial }: { initial: ParallelSettings }) {
  const [saved, setSaved] = useState(initial);
  const [draft, setDraft] = useState(initial);
  const [anchor, setAnchor] = useState<number | null>(null);
  const [error, setError] = useState<{ row: RowKey; message: string } | null>(null);
  // 保存の失敗（行ごと。同じ行の次の保存が成功したら消す）
  const [failures, setFailures] = useState<Partial<Record<RowKey, SaveFailureLine[]>>>({});
  const [busyRow, setBusyRow] = useState<RowKey | null>(null);
  const demo = useDemo();
  const reportFailure = useReportFailure();
  const applySaved = useParallelSaved();
  const markSaved = useMarkSaved();
  const minute = useSyncExternalStore(subscribeMinute, minuteNow, () => null);

  // 待っている保存と、最後に変えた行。タイマーの中から最新を読むので ref に置く
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
      // 同じ行の失敗の文を消す（ほかの行のは残す）
      setFailures((prev) => ({ ...prev, [row]: undefined }));
      reportFailure(`parallel:${row}`, false);
      markSaved();
      return;
    }
    // 失敗したら保存済みの値に戻す（そのあと変えた分が待っていれば、それは残す）
    if (!pending.current) setDraft(before);
    const lines = result.failures
      ? summarizeSaveFailures(result.failures, result.attempted ?? result.failures.length)
      : [{ text: result.message }];
    setFailures((prev) => ({ ...prev, [row]: lines }));
    reportFailure(`parallel:${row}`, true);
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

  function selectHours(result: SelectChange) {
    setAnchor(null);
    if (result.kind === "error") {
      setError({ row: "hours", message: result.message });
      return;
    }
    change({ ...draft, nightHours: result.hours }, "hours");
  }

  const now = demo ? demo.now : minute === null ? null : new Date(minute * 60_000);
  const current = now ? describeParallelNow(now, saved.nightHours) : null;
  const busy = busyRow !== null;
  const nightSpan = pickCountSpan(nightSpans(draft.nightHours));
  const daySpan = pickCountSpan(daySpans(draft.nightHours));

  return (
    <SettingsPanel>
      <div className={styles.parallel} data-busy={busy ? "" : undefined}>
        <p className={styles.nowLine}>
          {current ? (
            <>
              いま <span className={`${styles.nowTime} num`}>{current.time}</span> · {current.period}
            </>
          ) : (
            " "
          )}
        </p>
        <div className={styles.counts}>
          {nightSpan && (
            <CountGroup
              span={nightSpan}
              kind="night"
              value={draft.night}
              disabled={busy}
              onChange={(night) => change({ ...draft, night }, "night")}
            />
          )}
          {daySpan && (
            <CountGroup
              span={daySpan}
              kind="day"
              value={draft.day}
              disabled={busy}
              onChange={(day) => change({ ...draft, day }, "day")}
            />
          )}
        </div>
        <NightBand
          settings={draft}
          anchor={anchor}
          position={now ? nowPosition(now) : null}
          onPick={pick}
          onCancel={() => setAnchor(null)}
          disabled={busy}
        />
        <div className={styles.timeRow}>
          <span className={styles.countName}>
            <MoonIcon size={14} />
            Night
          </span>
          <Select
            className={styles.timeSelect}
            label="夜の始まり"
            options={START_OPTIONS}
            value={startSelectValue(draft.nightHours)}
            disabled={busy}
            onChange={(value) => selectHours(changeNightStart(draft.nightHours, value))}
          />
          {draft.nightHours && (
            <>
              <span className={styles.timeTo} aria-hidden="true">
                〜
              </span>
              <Select
                className={styles.timeSelect}
                label="夜の終わり"
                options={HOUR_OPTIONS}
                value={endSelectValue(draft.nightHours)}
                disabled={busy}
                onChange={(value) => selectHours(changeNightEnd(draft.nightHours, value))}
              />
            </>
          )}
        </div>
        {error && (
          <p className={styles.rowError} role="alert">
            {error.message}
          </p>
        )}
        <SaveFailureLines lines={uniqueLines(ROW_KEYS.flatMap((key) => failures[key] ?? []))} />
      </div>
    </SettingsPanel>
  );
}
