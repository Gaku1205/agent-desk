import type { Env } from "../config";

/**
 * デモの「今」。環境変数 `DEMO_NOW`（ISO形式）があればその時刻に固定する（見た目のテスト用）。
 * 無い・読めなければ、本当の今
 */
export function getDemoNow(env: Env = process.env, fallback: Date = new Date()): Date {
  const value = env.DEMO_NOW?.trim();
  if (!value) return fallback;
  const time = Date.parse(value);
  return Number.isNaN(time) ? fallback : new Date(time);
}
