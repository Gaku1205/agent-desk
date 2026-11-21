/**
 * Slots & Queue の Background の行で、作業の種類（`Watchdog`・`CI` など。ワークフローの名前から決めた英語）に添える説明。
 * 種類の名前は変えず、知らない人にも何をしている物か分かるようにする（Issue #743。docs/design.md の「Slots & Queue」）
 */
const KIND_NOTE: Record<string, string> = {
  Implement: "AIがコードを書いています",
  Review: "AIが変更を確かめています",
  Plan: "企画AIがIssueを清書しています",
  Fix: "AIが直しています",
  Design: "AIが画面案を作っています",
  CI: "CI（自動のチェック）が動いています",
  Watchdog: "見張り役：やり直しや見落としが無いか見回っています",
  Deploy: "本番に公開しています",
  Sync: "パイプラインの設定を、ほかのリポジトリへ写しています",
  Queue: "順番待ちの作業を始められるか確かめています",
  Resume: "時間をおいて、作業を自動でやり直します",
  "Visual update": "見た目のテストの基準の画像を撮り直しています",
  "Factory talk": "工場（新しいサービスを作る仕組み）が相談の答えを読んでいます",
  Factory: "工場（新しいサービスを作る仕組み）が作っています",
  Actions: "GitHub の自動の作業が動いています",
};

/** 種類に添える説明。知らない種類（ワークフローの名前のまま）は null */
export function runKindNote(kind: string): string | null {
  return KIND_NOTE[kind] ?? null;
}

/** Sleeping の行の2段目：`Retry timer` に添える説明 */
export const RETRY_TIMER_NOTE = "時間をおいて再開";
