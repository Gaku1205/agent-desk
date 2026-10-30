import { getSignedInLogin } from "@/lib/auth";
import { parseRepoList } from "@/lib/config";
import { getChangeMarks, isWebhookEnabled } from "@/lib/github/repoCache";
import { CHANGES_MAX_REPOS } from "@/lib/webhook";

/**
 * 監視リポジトリごとの「最後に変わった時刻」（docs/spec.md の「更新」）。`?repo=owner/repo` を並べて渡す。
 * Next.js のキャッシュから返し、GitHub には問い合わせない。Webhook を使わない設定なら 404
 */
export async function GET(request: Request): Promise<Response> {
  if (!isWebhookEnabled()) return new Response(null, { status: 404 });
  if (!(await getSignedInLogin())) return new Response(null, { status: 401 });
  const params = new URL(request.url).searchParams;
  const repos = parseRepoList(params.getAll("repo").join(",")).slice(0, CHANGES_MAX_REPOS);
  return Response.json(
    { changes: await getChangeMarks(repos) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
