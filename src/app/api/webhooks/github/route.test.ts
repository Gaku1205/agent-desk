import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rememberWatchedRepos, subscribeLiveRefresh } from "@/lib/liveRefresh";
import { POST } from "./route";

const secret = "test-secret";
const body = JSON.stringify({ action: "labeled", repository: { full_name: "Gaku1205/agent-desk" } });
const sign = (text: string) =>
  `sha256=${createHmac("sha256", secret).update(text, "utf8").digest("hex")}`;

function webhook(headers: Record<string, string>, text = body): Request {
  return new Request("http://localhost/api/webhooks/github", { method: "POST", headers, body: text });
}

describe("POST /api/webhooks/github", () => {
  const listener = vi.fn();
  let unsubscribe = () => {};

  beforeEach(() => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", secret);
    rememberWatchedRepos([{ owner: "Gaku1205", repo: "agent-desk" }]);
    unsubscribe = subscribeLiveRefresh(listener);
  });
  afterEach(() => {
    unsubscribe();
    listener.mockReset();
    vi.unstubAllEnvs();
  });

  it("署名が正しければ 202 で、つながっている画面に伝える", async () => {
    const response = await POST(
      webhook({ "X-GitHub-Event": "issues", "X-Hub-Signature-256": sign(body) }),
    );
    expect(response.status).toBe(202);
    expect(listener).toHaveBeenCalledWith("Gaku1205/agent-desk");
  });

  it("署名が違う・無いときは 401 で、伝えない", async () => {
    const wrong = await POST(
      webhook({ "X-GitHub-Event": "issues", "X-Hub-Signature-256": sign(`${body} `) }),
    );
    const missing = await POST(webhook({ "X-GitHub-Event": "issues" }));
    expect(wrong.status).toBe(401);
    expect(missing.status).toBe(401);
    expect(listener).not.toHaveBeenCalled();
  });

  it("秘密が未設定なら 503 で、伝えない", async () => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "");
    const response = await POST(
      webhook({ "X-GitHub-Event": "issues", "X-Hub-Signature-256": sign(body) }),
    );
    expect(response.status).toBe(503);
    expect(listener).not.toHaveBeenCalled();
  });

  it("対象外のイベント・監視していないリポジトリは 2xx で、伝えない", async () => {
    const ping = await POST(webhook({ "X-GitHub-Event": "ping", "X-Hub-Signature-256": sign(body) }));
    const other = JSON.stringify({ repository: { full_name: "someone/else" } });
    const unwatched = await POST(
      webhook({ "X-GitHub-Event": "issues", "X-Hub-Signature-256": sign(other) }, other),
    );
    expect(ping.status).toBe(200);
    expect(unwatched.status).toBe(200);
    expect(listener).not.toHaveBeenCalled();
  });
});
