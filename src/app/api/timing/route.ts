import { getGitHubToken, getSignedInLogin } from "@/lib/auth";
import { getRepoResult } from "@/lib/github/fetch";
import { getChangeMarks, isWebhookEnabled } from "@/lib/github/repoCache";
import {
  formatServerTiming,
  instanceAgeMs,
  roundTimingMs,
  startStageTimer,
  type TimingStage,
} from "@/lib/serverTiming";
import { loadWatchedRepos } from "@/lib/watchedRepos";

/** 段の名前と、その日本語の説明（返事の本文に添える。ヘッダーには名前と ms だけ） */
const STAGE_LABELS: Record<string, string> = {
  auth: "ログインの確認（Cookie を読む）",
  watched: "監視するリポジトリの一覧（覚えた物。無ければ GitHub）",
  token: "GitHub のトークンを取り出す（Cookie を読む）",
  marks: "「変わった」印を読む（キャッシュだけ。GitHub は読まない）",
  "first-repo": "最初のリポジトリを読み終えるまで（覚えた物。無ければ GitHub）",
  repos: "全部のリポジトリを読み終えるまで",
  total: "全部",
  instance: "このサーバーが立ち上がってからの時間（小さければ、冷えた起動の直後）",
};

/**
 * サーバーの各段にかかった時間（docs/spec.md の「サーバーの各段の時間」）。本番でどこが遅いかを確かめるための物。
 * ページの表示と同じ順（ログインの確認 → 監視するリポジトリ → 各リポジトリ）を1回通して、段ごとの ms を
 * `Server-Timing` ヘッダーと本文（JSON）で返す。段の名前と ms だけで、リポジトリの名前・データ・トークンは返さない。
 * 読み方はページと同じ（覚えた物があれば GitHub を読まない）。ログインしていなければ 401
 */
export async function GET(): Promise<Response> {
  const timer = startStageTimer();
  const login = await timer.time("auth", () => getSignedInLogin());
  if (!login) return new Response(null, { status: 401, headers: { "Cache-Control": "no-store" } });

  const { repos } = await timer.time("watched", () => loadWatchedRepos());
  const token = await timer.time("token", () => getGitHubToken());
  if (isWebhookEnabled()) await timer.time("marks", () => getChangeMarks(repos));
  if (token && repos.length > 0) {
    // 全部を同時に読み始め、最初の1つが終わった時と、全部が終わった時を残す
    const from = performance.now();
    const reads = repos.map((repo) => getRepoResult(token, repo));
    await Promise.race(reads);
    timer.add("first-repo", performance.now() - from);
    await Promise.all(reads);
    timer.add("repos", performance.now() - from);
  }
  timer.mark("total");
  return respond(timer.stages(), repos.length);
}

function respond(measured: TimingStage[], repoCount: number): Response {
  const stages = [...measured, { name: "instance", ms: roundTimingMs(instanceAgeMs()) }];
  return Response.json(
    {
      stages: stages.map((stage) => ({ ...stage, label: STAGE_LABELS[stage.name] ?? "" })),
      repoCount,
      // Vercel の関数の地域（`hnd1`＝東京、`iad1`＝米国東部 など）。手元では null
      region: process.env.VERCEL_REGION ?? null,
    },
    { headers: { "Cache-Control": "no-store", "Server-Timing": formatServerTiming(stages) } },
  );
}
