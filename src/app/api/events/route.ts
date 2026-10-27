import { getSignedInLogin } from "@/lib/auth";
import {
  formatSseEvent,
  SSE_PING,
  SSE_PING_INTERVAL_MS,
  subscribeLiveRefresh,
} from "@/lib/liveRefresh";

/**
 * 即時反映のSSE（docs/spec.md の「即時反映」）。ログイン中・許可リストのユーザーだけつなげる。
 * Webhookを受けたら `event: refresh` を送る
 */
export async function GET(request: Request): Promise<Response> {
  const login = await getSignedInLogin();
  if (!login) return new Response("unauthorized", { status: 401 });

  const encoder = new TextEncoder();
  let cleanup = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const send = (text: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          cleanup();
        }
      };

      const unsubscribe = subscribeLiveRefresh((repo) => send(formatSseEvent("refresh", repo)));
      const ping = setInterval(() => send(SSE_PING), SSE_PING_INTERVAL_MS);

      cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(ping);
        unsubscribe();
        request.signal.removeEventListener("abort", onAbort);
        try {
          controller.close();
        } catch {
          // もう閉じている
        }
      };
      const onAbort = () => cleanup();
      request.signal.addEventListener("abort", onAbort);

      send(formatSseEvent("ready", "ok"));
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
