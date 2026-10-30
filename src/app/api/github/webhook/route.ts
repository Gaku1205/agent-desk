import { revalidateTag } from "next/cache";
import { loadWebhookWatchedRepos } from "@/lib/github/repoCache";
import { decideWebhook, repoTag } from "@/lib/webhook";

/**
 * パイプラインの GitHub App の Webhook を受け取り、そのリポジトリのキャッシュを無効にする（docs/spec.md の「更新」）。
 * ログインは要らない（署名 `X-Hub-Signature-256` が認証の代わり）。本文は保存しない・ログに出さない
 */
export async function POST(request: Request): Promise<Response> {
  const decision = await decideWebhook({
    secret: process.env.GITHUB_WEBHOOK_SECRET,
    signature: request.headers.get("x-hub-signature-256"),
    event: request.headers.get("x-github-event"),
    body: await request.text(),
    loadWatched: () => loadWebhookWatchedRepos(),
  });
  if (decision.status === 202) {
    // 次にそのリポジトリを読むときは、古い物を出さずに取り直す。「変わった」印も同じタグなので進む
    revalidateTag(repoTag(decision.invalidate), { expire: 0 });
  }
  return new Response(null, { status: decision.status });
}
