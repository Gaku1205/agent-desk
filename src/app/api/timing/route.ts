import { getGitHubToken, getSignedInLogin } from "@/lib/auth";
import { withCallLog, type CallTotals } from "@/lib/github/callLog";
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
  "slowest-repo": "いちばん遅かったリポジトリ1つ（下の repos で、何番目かが分かる）",
  "gh-graphql": "GitHub の GraphQL を呼んだ時間の合計（同時に呼ぶので、足すと total より長くなる）",
  "gh-rest": "GitHub の REST（Actions の実行・ジョブ・読めるかの確認など）を呼んだ時間の合計",
  "gh-key": "App の鍵の確認と取得（インストールを調べる・鍵を取る）を呼んだ時間の合計",
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
  let repoRows: RepoRow[] = [];
  let calls: CallTotals | null = null;
  if (token && repos.length > 0) {
    // 全部を同時に読み始め、最初の1つが終わった時と、全部が終わった時を残す。リポジトリごとの時間と、GitHub を呼んだ回数も数える
    const from = performance.now();
    const logged = await withCallLog(async () => {
      const reads = repos.map(async (repo, index): Promise<RepoRow> => {
        const result = await getRepoResult(token, repo);
        const ms = roundTimingMs(performance.now() - from);
        return {
          // 名前は返さない。設定の「監視するリポジトリ」の並びで何番目か
          n: index + 1,
          ms,
          ok: result.ok,
          source: result.readSource ?? null,
          kb: result.ok ? Math.round(Buffer.byteLength(JSON.stringify(result.data)) / 1024) : null,
        };
      });
      await Promise.race(reads);
      timer.add("first-repo", performance.now() - from);
      const rows = await Promise.all(reads);
      timer.add("repos", performance.now() - from);
      return rows;
    });
    repoRows = logged.value;
    calls = logged.calls;
    timer.add("slowest-repo", Math.max(...repoRows.map((row) => row.ms)));
    timer.add("gh-graphql", calls.graphql.ms);
    timer.add("gh-rest", calls.rest.ms);
    timer.add("gh-key", calls.key.ms);
  }
  timer.mark("total");
  return respond(timer.stages(), repoRows, calls);
}

/** リポジトリ1つ分：何番目か・読み終えるまでの ms・読めたか・どの鍵で読んだか・データの大きさ（KB） */
type RepoRow = { n: number; ms: number; ok: boolean; source: "app" | "user" | null; kb: number | null };

function respond(measured: TimingStage[], repos: RepoRow[], calls: CallTotals | null): Response {
  const stages = [...measured, { name: "instance", ms: roundTimingMs(instanceAgeMs()) }];
  return Response.json(
    {
      stages: stages.map((stage) => ({ ...stage, label: STAGE_LABELS[stage.name] ?? "" })),
      repoCount: repos.length,
      // リポジトリごと（名前は入れない。設定の並びで何番目か）。ms が数十以下なら覚えた物、数百以上なら GitHub を読んだ
      repos,
      // GitHub を呼んだ回数と時間（種類ごと。count＝回数、ms＝合計、maxMs＝いちばん長い1回）
      calls: calls
        ? Object.fromEntries(
            Object.entries(calls).map(([kind, total]) => [
              kind,
              { count: total.count, ms: roundTimingMs(total.ms), maxMs: roundTimingMs(total.maxMs) },
            ]),
          )
        : null,
      // Vercel の関数の地域（`hnd1`＝東京、`iad1`＝米国東部 など）。手元では null
      region: process.env.VERCEL_REGION ?? null,
    },
    { headers: { "Cache-Control": "no-store", "Server-Timing": formatServerTiming(stages) } },
  );
}
