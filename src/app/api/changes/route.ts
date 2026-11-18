import { getSignedInLogin } from "@/lib/auth";
import { parseRepoList } from "@/lib/config";
import { getChangeMarks, isWebhookEnabled } from "@/lib/github/repoCache";
import { formatServerTiming, startStageTimer } from "@/lib/serverTiming";
import { CHANGES_MAX_REPOS } from "@/lib/webhook";

/**
 * 監視リポジトリごとの「最後に変わった時刻」（docs/spec.md の「更新」）。`?repo=owner/repo` を並べて渡す。
 * Next.js のキャッシュから返し、GitHub には問い合わせない。Webhook を使わない設定なら 404。
 * 返事の `Server-Timing` に、段ごとの時間（`auth`・`marks`。名前と ms だけ）を入れる（「サーバーの各段の時間」）
 */
export async function GET(request: Request): Promise<Response> {
  if (!isWebhookEnabled()) return new Response(null, { status: 404 });
  const timer = startStageTimer();
  if (!(await timer.time("auth", () => getSignedInLogin()))) return new Response(null, { status: 401 });
  const params = new URL(request.url).searchParams;
  const repos = parseRepoList(params.getAll("repo").join(",")).slice(0, CHANGES_MAX_REPOS);
  const changes = await timer.time("marks", () => getChangeMarks(repos));
  return Response.json(
    { changes },
    { headers: { "Cache-Control": "no-store", "Server-Timing": formatServerTiming(timer.stages()) } },
  );
}
