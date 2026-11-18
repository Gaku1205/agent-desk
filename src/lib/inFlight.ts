// 同じ物を同時に取りに行くのを1回にまとめる（GitHub の呼び出しを増やさないため。docs/spec.md の「Webhook で取り直す」）

/**
 * `key` の処理がもう動いていれば、その結果を待つ。動いていなければ `run` を始めて、終わるまで `inFlight` に置く。
 * 終わったら（成功でも失敗でも）取り除くので、結果は覚えない（覚えるのはキャッシュの役目）。失敗は、待っていた全員に同じく伝わる
 */
export function shareInFlight<T>(inFlight: Map<string, Promise<T>>, key: string, run: () => Promise<T>): Promise<T> {
  const running = inFlight.get(key);
  if (running) return running;
  const started = run().finally(() => {
    if (inFlight.get(key) === started) inFlight.delete(key);
  });
  inFlight.set(key, started);
  return started;
}
