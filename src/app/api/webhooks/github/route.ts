import { getLiveWatchedRepos, publishLiveRefresh } from "@/lib/liveRefresh";
import { getWebhookSecret, routeWebhook, verifyWebhookSignature } from "@/lib/webhook";

/**
 * GitHubのWebhookを受けて、つながっている画面に「取り直して」を伝える（docs/spec.md の「即時反映」）。
 * 署名を確かめられないとき（秘密が未設定）は受け付けない
 */
export async function POST(request: Request): Promise<Response> {
  const secret = getWebhookSecret();
  if (!secret) return new Response("webhook secret is not configured", { status: 503 });

  const body = await request.text();
  if (!verifyWebhookSignature(secret, body, request.headers.get("x-hub-signature-256"))) {
    return new Response("invalid signature", { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    payload = null;
  }

  const route = routeWebhook(request.headers.get("x-github-event"), payload, getLiveWatchedRepos());
  if (route.kind === "ignore") return new Response(`ignored: ${route.reason}`, { status: 200 });

  publishLiveRefresh(route.repo);
  return new Response("accepted", { status: 202 });
}
