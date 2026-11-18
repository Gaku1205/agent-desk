import { createHmac, randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  decideWebhook,
  isNoChangeWebhook,
  isUrgentWebhook,
  isUsedWebhookEvent,
  isWatchedRepo,
  repoTag,
  urgentTag,
  verifyWebhookSignature,
  webhookRepo,
} from "./webhook";

// 秘密はテストの中で作る（本物の値は書かない）
const SECRET = randomBytes(32).toString("hex");

function sign(body: string, secret: string = SECRET): string {
  return `sha256=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;
}

const BODY = JSON.stringify({ action: "opened", repository: { full_name: "Owner/Repo" } });

describe("verifyWebhookSignature", () => {
  it("同じ合言葉で作った署名なら合う", () => {
    expect(verifyWebhookSignature(BODY, sign(BODY), SECRET)).toBe(true);
  });

  it("合言葉が違う・本文が違う・署名が無い・形が違うときは合わない", () => {
    expect(verifyWebhookSignature(BODY, sign(BODY, `${SECRET}x`), SECRET)).toBe(false);
    expect(verifyWebhookSignature(`${BODY} `, sign(BODY), SECRET)).toBe(false);
    expect(verifyWebhookSignature(BODY, null, SECRET)).toBe(false);
    expect(verifyWebhookSignature(BODY, "sha1=abc", SECRET)).toBe(false);
    expect(verifyWebhookSignature(BODY, "sha256=zz", SECRET)).toBe(false);
  });
});

describe("isUsedWebhookEvent", () => {
  it("決めたイベントだけを使う", () => {
    for (const event of [
      "issues",
      "issue_comment",
      "pull_request",
      "pull_request_review_comment",
      "check_run",
      "status",
      "workflow_run",
      "label",
    ]) {
      expect(isUsedWebhookEvent(event)).toBe(true);
    }
    // チェックの変化は check_run、実行の変化は workflow_run で来るので、check_suite は使わない
    expect(isUsedWebhookEvent("check_suite")).toBe(false);
    expect(isUsedWebhookEvent("ping")).toBe(false);
    expect(isUsedWebhookEvent("push")).toBe(false);
    expect(isUsedWebhookEvent(null)).toBe(false);
  });
});

describe("webhookRepo", () => {
  it("repository.full_name を読む。無い・形が違うときは null", () => {
    expect(webhookRepo({ repository: { full_name: "o/r" } })).toEqual({ owner: "o", repo: "r" });
    expect(webhookRepo({ repository: { full_name: "o" } })).toBeNull();
    expect(webhookRepo({ repository: null })).toBeNull();
    expect(webhookRepo({})).toBeNull();
    expect(webhookRepo("x")).toBeNull();
  });
});

describe("isWatchedRepo", () => {
  const watched = [{ owner: "owner", repo: "repo" }];

  it("監視しているリポジトリか（大文字・小文字は区別しない）", () => {
    expect(isWatchedRepo({ owner: "Owner", repo: "Repo" }, watched)).toBe(true);
    expect(isWatchedRepo({ owner: "owner", repo: "other" }, watched)).toBe(false);
  });

  it("分からない（null）ときは使う側に倒す", () => {
    expect(isWatchedRepo({ owner: "a", repo: "b" }, null)).toBe(true);
  });
});

describe("repoTag", () => {
  it("repo:<owner>/<repo> を小文字で", () => {
    expect(repoTag({ owner: "Owner", repo: "Repo" })).toBe("repo:owner/repo");
  });
});

describe("decideWebhook", () => {
  const loadWatched = async () => [{ owner: "owner", repo: "repo" }];

  it("正しい署名・使うイベント・監視リポジトリなら、そのリポジトリを無効にする（202）", async () => {
    expect(
      await decideWebhook({
        secret: SECRET,
        signature: sign(BODY),
        event: "pull_request",
        body: BODY,
        loadWatched,
      }),
    ).toEqual({ status: 202, invalidate: { owner: "Owner", repo: "Repo" }, urgent: true });
  });

  it("環境変数が無ければ 404（署名も見ない）", async () => {
    const watched = vi.fn(loadWatched);
    expect(
      await decideWebhook({ secret: undefined, signature: sign(BODY), event: "issues", body: BODY, loadWatched: watched }),
    ).toEqual({ status: 404 });
    expect(
      await decideWebhook({ secret: "", signature: sign(BODY), event: "issues", body: BODY, loadWatched: watched }),
    ).toEqual({ status: 404 });
    expect(watched).not.toHaveBeenCalled();
  });

  it("署名が違う・無いときは 401", async () => {
    expect(
      await decideWebhook({ secret: SECRET, signature: sign(BODY, "other"), event: "issues", body: BODY, loadWatched }),
    ).toEqual({ status: 401 });
    expect(
      await decideWebhook({ secret: SECRET, signature: null, event: "issues", body: BODY, loadWatched }),
    ).toEqual({ status: 401 });
  });

  it("使わないイベント・監視していないリポジトリ・形が違う本文は 204", async () => {
    expect(
      await decideWebhook({ secret: SECRET, signature: sign(BODY), event: "push", body: BODY, loadWatched }),
    ).toEqual({ status: 204 });
    const other = JSON.stringify({ repository: { full_name: "owner/other" } });
    expect(
      await decideWebhook({ secret: SECRET, signature: sign(other), event: "issues", body: other, loadWatched }),
    ).toEqual({ status: 204 });
    expect(
      await decideWebhook({ secret: SECRET, signature: sign("{"), event: "issues", body: "{", loadWatched }),
    ).toEqual({ status: 204 });
  });

  it("画面のデータが変わらない知らせ（作られただけ・飛ばされた実行）は 204。動き出し・飛ばされていない完了は 202", async () => {
    const run = (action: string, conclusion: string | null) =>
      JSON.stringify({ action, workflow_run: { conclusion }, repository: { full_name: "Owner/Repo" } });
    const decide = (body: string) =>
      decideWebhook({ secret: SECRET, signature: sign(body), event: "workflow_run", body, loadWatched });
    expect(await decide(run("requested", null))).toEqual({ status: 204 });
    expect(await decide(run("completed", "skipped"))).toEqual({ status: 204 });
    expect(await decide(run("in_progress", null))).toMatchObject({ status: 202, urgent: false });
    expect(await decide(run("completed", "success"))).toMatchObject({ status: 202 });
    expect(await decide(run("completed", "failure"))).toMatchObject({ status: 202 });
    expect(await decide(run("completed", "cancelled"))).toMatchObject({ status: 202 });
    const suite = JSON.stringify({ action: "completed", repository: { full_name: "Owner/Repo" } });
    expect(
      await decideWebhook({ secret: SECRET, signature: sign(suite), event: "check_suite", body: suite, loadWatched }),
    ).toEqual({ status: 204 });
  });
});

describe("isNoChangeWebhook", () => {
  it("workflow_run の requested と、skipped で終わった completed だけ", () => {
    expect(isNoChangeWebhook("workflow_run", { action: "requested", workflow_run: {} })).toBe(true);
    expect(isNoChangeWebhook("workflow_run", { action: "completed", workflow_run: { conclusion: "skipped" } })).toBe(true);
    expect(isNoChangeWebhook("workflow_run", { action: "completed", workflow_run: { conclusion: "success" } })).toBe(false);
    expect(isNoChangeWebhook("workflow_run", { action: "in_progress", workflow_run: { conclusion: null } })).toBe(false);
  });

  it("ほかのイベント・形が違う本文は、変わる物として扱う（取り直す側に倒す）", () => {
    expect(isNoChangeWebhook("check_run", { action: "completed", check_run: { conclusion: "skipped" } })).toBe(false);
    expect(isNoChangeWebhook("issues", { action: "requested" })).toBe(false);
    expect(isNoChangeWebhook("workflow_run", null)).toBe(false);
    expect(isNoChangeWebhook("workflow_run", { action: "completed" })).toBe(false);
    expect(isNoChangeWebhook("workflow_run", { action: "completed", workflow_run: null })).toBe(false);
    expect(isNoChangeWebhook(null, { action: "requested" })).toBe(false);
  });
});

describe("isUrgentWebhook", () => {
  it("issues：題名・本文の書き換え以外は急ぎ", () => {
    for (const action of ["opened", "closed", "reopened", "labeled", "unlabeled"]) {
      expect(isUrgentWebhook("issues", { action })).toBe(true);
    }
    expect(isUrgentWebhook("issues", { action: "edited" })).toBe(false);
    expect(isUrgentWebhook("issues", {})).toBe(false);
  });

  it("pull_request：できた・閉じた・ラベルの付け外しなどは急ぎ。コミットの追加・書き換えは急ぎでない", () => {
    for (const action of ["opened", "closed", "reopened", "labeled", "unlabeled", "ready_for_review", "converted_to_draft"]) {
      expect(isUrgentWebhook("pull_request", { action })).toBe(true);
    }
    expect(isUrgentWebhook("pull_request", { action: "synchronize" })).toBe(false);
    expect(isUrgentWebhook("pull_request", { action: "edited" })).toBe(false);
  });

  it("issue_comment：新しいコメントだけ急ぎ（作業中のコメントの書き換えは急ぎでない）", () => {
    expect(isUrgentWebhook("issue_comment", { action: "created" })).toBe(true);
    expect(isUrgentWebhook("issue_comment", { action: "edited" })).toBe(false);
    expect(isUrgentWebhook("issue_comment", { action: "deleted" })).toBe(false);
  });

  it("check_run：PR のチェックが終わったときだけ急ぎ（飛ばされた物・PR に付かない物・途中は急ぎでない）", () => {
    const run = (action: string, conclusion: string | null, pulls: unknown[] = [{ number: 1 }]) => ({
      action,
      check_run: { conclusion, pull_requests: pulls },
    });
    expect(isUrgentWebhook("check_run", run("completed", "success"))).toBe(true);
    expect(isUrgentWebhook("check_run", run("completed", "failure"))).toBe(true);
    expect(isUrgentWebhook("check_run", run("completed", "skipped"))).toBe(false);
    expect(isUrgentWebhook("check_run", run("completed", "neutral"))).toBe(false);
    expect(isUrgentWebhook("check_run", run("completed", "success", []))).toBe(false);
    expect(isUrgentWebhook("check_run", run("created", null))).toBe(false);
    expect(isUrgentWebhook("check_run", { action: "completed" })).toBe(false);
  });

  it("status：決まったとき（pending でない）だけ急ぎ", () => {
    expect(isUrgentWebhook("status", { state: "success" })).toBe(true);
    expect(isUrgentWebhook("status", { state: "failure" })).toBe(true);
    expect(isUrgentWebhook("status", { state: "pending" })).toBe(false);
    expect(isUrgentWebhook("status", {})).toBe(false);
  });

  it("ほかのイベント・形が読めない本文は急ぎでない", () => {
    expect(isUrgentWebhook("workflow_run", { action: "completed", workflow_run: { conclusion: "success" } })).toBe(false);
    expect(isUrgentWebhook("label", { action: "created" })).toBe(false);
    expect(isUrgentWebhook("pull_request_review_comment", { action: "created" })).toBe(false);
    expect(isUrgentWebhook("issues", null)).toBe(false);
    expect(isUrgentWebhook(null, { action: "opened" })).toBe(false);
  });
});

describe("urgentTag", () => {
  it("urgent:<owner>/<repo> を小文字で", () => {
    expect(urgentTag({ owner: "Owner", repo: "Repo" })).toBe("urgent:owner/repo");
  });
});
