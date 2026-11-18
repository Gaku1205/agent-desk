"use client";

import {
  createContext,
  useCallback,
  useContext,
  startTransition,
  useEffect,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import {
  loadParallelSnapshot,
  setParallelOverride,
  type ParallelOverrideResult,
  type ParallelSnapshot,
} from "@/app/(app)/settings/actions";
import { ACTION_UNREACHABLE_MESSAGE, callAction } from "@/lib/actionCall";
import {
  applySavedParallelSettings,
  PARALLEL_SETTINGS_CHANNEL,
  parseSavedParallelMessage,
  planParallelToggle,
  resolveParallelState,
  type ParallelSettings,
  type ParallelState,
} from "@/lib/parallel";

/** 帯（PCは左のバー・スマホはメニュー）の並列のボタンが使う物 */
export type ParallelView = {
  /** いまの状態。まだ読めていない・読めない（ログインしていない・`SETTINGS_REPO` が無い）ときは null（ボタンを出さない） */
  state: ParallelState | null;
  /** 読んだ設定（昼・夜の数と夜の時間帯）。読めていないときは null。Slots & Queue の見出しが使う（読み直さない） */
  settings: ParallelSettings | null;
  /** 切り替えを書いている最中 */
  busy: boolean;
  /** 切り替えに失敗した理由（次に押すまで出す） */
  error: string | null;
  /** 押す：今と反対へ切り替える。上書き中なら消して時間帯の決まりに戻す */
  toggle: () => void;
};

const ParallelContext = createContext<ParallelView | null>(null);

export const ParallelViewProvider = ParallelContext.Provider;

/** 設定で保存した値を帯に渡す入口。デモ（Provider の外）では null */
const ParallelSavedContext = createContext<((saved: ParallelSettings) => void) | null>(null);

export function useParallelSaved(): ((saved: ParallelSettings) => void) | null {
  return useContext(ParallelSavedContext);
}

export function useParallelView(): ParallelView | null {
  return useContext(ParallelContext);
}

function minuteNow(): number {
  return Math.floor(Date.now() / 60_000);
}

/**
 * 1分ごとに変わる「いま」（分）。サーバーでの描画と、ブラウザの最初の描画では null。
 * ブラウザでは、読み込んだ直後と1分ごとに、トランジションで入れる。`useSyncExternalStore` のように同期で入れると、
 * サーバーが返した HTML を React がまだ引き継ぎ終えていない（ハイドレーションの途中の）ページの本文が、
 * 骨組みに差し戻されて作り直される（中身 → 骨組み → 中身と点滅する。docs/spec.md の「押した瞬間の反応と、読み込み中」）
 */
function useMinute(): number | null {
  const [minute, setMinute] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => startTransition(() => setMinute(minuteNow()));
    tick();
    const timer = window.setInterval(tick, 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return minute;
}

/** 設定を読み直す間隔（手元で切り替えた分は、すぐ画面に反映する） */
const RELOAD_MS = 5 * 60_000;

/** 本物の画面：設定と上書きを読み、1分ごとに状態を見直し、押したら Server Action で書く */
export function ParallelProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<ParallelSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, startBusy] = useTransition();
  const minute = useMinute();

  useEffect(() => {
    let alive = true;
    async function load() {
      const loaded = await callAction(loadParallelSnapshot, () => null);
      if (alive && loaded) setSnapshot(loaded);
    }
    void load();
    const timer = window.setInterval(() => void load(), RELOAD_MS);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  const state =
    snapshot && minute !== null
      ? resolveParallelState(new Date(minute * 60_000), snapshot.settings, snapshot.override)
      : null;

  const toggle = useCallback(() => {
    if (!snapshot) return;
    setError(null);
    const plan = planParallelToggle(new Date(), snapshot.settings, snapshot.override);
    const value = plan.mode === "clear" ? "clear" : plan.override.period;
    startBusy(async () => {
      const result = await callAction<ParallelOverrideResult>(
        () => setParallelOverride(value),
        () => ({ ok: false, message: ACTION_UNREACHABLE_MESSAGE }),
      );
      if (result.ok) setSnapshot(result.snapshot);
      else setError(result.message);
    });
  }, [snapshot]);

  // 設定で保存した値を受け取る入口（読み直さず、保存した値で更新する）
  const applySaved = useCallback((saved: ParallelSettings) => {
    setSnapshot((current) => applySavedParallelSettings(current, saved));
  }, []);

  // 同じブラウザの別タブで保存された設定を受け取る（BroadcastChannel が無い環境では何もしない）
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    let channel: BroadcastChannel;
    try {
      channel = new BroadcastChannel(PARALLEL_SETTINGS_CHANNEL);
    } catch {
      return;
    }
    channel.onmessage = (event: MessageEvent) => {
      const saved = parseSavedParallelMessage(event.data);
      if (saved) applySaved(saved);
    };
    return () => channel.close();
  }, [applySaved]);

  return (
    <ParallelSavedContext.Provider value={applySaved}>
      <ParallelContext.Provider value={{ state, settings: state ? (snapshot?.settings ?? null) : null, busy, error, toggle }}>{children}</ParallelContext.Provider>
    </ParallelSavedContext.Provider>
  );
}

/** 保存した並列の設定を、別タブへ知らせる（届かない環境では何もしない） */
export function broadcastParallelSettings(saved: ParallelSettings): void {
  if (typeof BroadcastChannel === "undefined") return;
  try {
    const channel = new BroadcastChannel(PARALLEL_SETTINGS_CHANNEL);
    channel.postMessage(saved);
    channel.close();
  } catch {
    // 届かなくても、5分ごとの読み直しで揃う
  }
}
