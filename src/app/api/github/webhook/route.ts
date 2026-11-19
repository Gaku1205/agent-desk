import { revalidateTag } from "next/cache";
import { after } from "next/server";
import { claimWebhookSlot, loadWebhookWatchedRepos } from "@/lib/github/repoCache";
import { decideWebhook, repoTag, urgentTag } from "@/lib/webhook";
import { invalidationPeriod, msUntilNextInvalidationPeriod, planInvalidation } from "@/lib/webhookThrottle";

/**
 * パイプラインの GitHub App の Webhook を受け取り、そのリポジトリのキャッシュを無効にする（docs/spec.md の「更新」）。
 * ログインは要らない（署名 `X-Hub-Signature-256` が認証の代わり）。本文は保存しない・ログに出さない。
 * 急ぎでない知らせは、同じリポジトリで30秒に1回までしか無効にしない（残りは次の区切りの1回にまとめる）
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
    const repo = decision.invalidate;
    const now = Date.now();
    const plan = await planInvalidation({
      urgent: decision.urgent,
      now,
      claim: (kind, period) => claimWebhookSlot(repo, kind, period),
    });
    if (plan === "now") {
      // 次にそのリポジトリを読むときは、古い物を出さずに取り直す。「変わった」印も同じタグなので進む
      revalidateTag(repoTag(repo), { expire: 0 });
      // 急ぎの知らせ（段階・誰の番が変わりうる物）は、その印も進める（`/api/changes` が、残してある持ち分ですぐ取り直す）
      if (decision.urgent) revalidateTag(urgentTag(repo), { expire: 0 });
    } else if (plan === "defer") {
      // この区切りの残りの知らせは、次の区切りの頭で1回だけ無効にする（待っている間は CPU を使わない）
      after(async () => {
        await new Promise((resolve) => setTimeout(resolve, msUntilNextInvalidationPeriod(now)));
        await claimWebhookSlot(repo, "invalidate", invalidationPeriod(Date.now()));
        revalidateTag(repoTag(repo), { expire: 0 });
      });
    }
  }
  return new Response(null, { status: decision.status });
}
