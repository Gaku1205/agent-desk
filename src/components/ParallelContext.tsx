"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
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
import { planParallelToggle, resolveParallelState, type ParallelState } from "@/lib/parallel";

/** 帯（PCは左のバー・スマホはメニュー）の並列のボタンが使う物 */
export type ParallelView = {
  /** いまの状態。まだ読めていない・読めない（ログインしていない・`SETTINGS_REPO` が無い）ときは null（ボタンを出さない） */
  state: ParallelState | null;
  /** 切り替えを書いている最中 */
  busy: boolean;
  /** 切り替えに失敗した理由（次に押すまで出す） */
  error: string | null;
  /** 押す：今と反対へ切り替える。上書き中なら消して時間帯の決まりに戻す */
  toggle: () => void;
};

const ParallelContext = createContext<ParallelView | null>(null);

export const ParallelViewProvider = ParallelContext.Provider;

export function useParallelView(): ParallelView | null {
  return useContext(ParallelContext);
}

/** 1分ごとに変わる「いま」（分）。サーバーでの描画では null */
function subscribeMinute(onChange: () => void): () => void {
  const timer = window.setInterval(onChange, 60_000);
  return () => window.clearInterval(timer);
}
function minuteNow(): number {
  return Math.floor(Date.now() / 60_000);
}

/** 設定を読み直す間隔（手元で切り替えた分は、すぐ画面に反映する） */
const RELOAD_MS = 5 * 60_000;

/** 本物の画面：設定と上書きを読み、1分ごとに状態を見直し、押したら Server Action で書く */
export function ParallelProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<ParallelSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, startBusy] = useTransition();
  const minute = useSyncExternalStore(subscribeMinute, minuteNow, () => null);

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

  return <ParallelContext.Provider value={{ state, busy, error, toggle }}>{children}</ParallelContext.Provider>;
}
