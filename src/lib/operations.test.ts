import { describe, expect, it } from "vitest";
import { GitHubClient } from "./github/client";
import { GitHubError } from "./github/errors";
import { encodeBase64, encodeFactoryMark } from "./factoryTalk";
import { parseImageUrls } from "./issueImages";
import type { CheckRunData, IssueData, PullData, RepoData } from "./github/types";
import {
  authorizeOperation,
  executeCreateIssue,
  executeOperation,
  executeUploadIssueImage,
  OPERATION_MESSAGES,
  operationErrorMessage,
  parseOperationInput,
  type OperationInput,
} from "./operations";

const NOW = new Date("2026-10-25T12:00:00Z");
const TOKEN = "ghp_secret_token_value";
const TARGET = { owner: "o", repo: "r" };
const WATCHED = [TARGET, { owner: "o", repo: "other" }];

function issue(overrides: Partial<IssueData> = {}): IssueData {
  return {
    number: 1,
    title: "あなたの番",
    body: "",
    state: "open",
    labels: [],
    url: "https://github.com/o/r/issues/1",
    createdAt: "2026-10-25T09:00:00Z",
    updatedAt: "2026-10-25T09:00:00Z",
    closedAt: null,
    ...overrides,
  };
}

function pull(overrides: Partial<PullData> = {}): PullData {
  return {
    number: 10,
    title: "PR",
    body: "Closes #1",
    state: "open",
    merged: false,
    labels: ["ai:hold"],
    url: "https://github.com/o/r/pull/10",
    headRef: "claude/issue-1-20261025-1000",
    headSha: "abc123",
    mergeCommitSha: null,
    createdAt: "2026-10-25T10:00:00Z",
    updatedAt: "2026-10-25T10:00:00Z",
    mergedAt: null,
    ...overrides,
  };
}

function check(overrides: Partial<CheckRunData> = {}): CheckRunData {
  return {
    name: "check",
    status: "completed",
    conclusion: "success",
    appSlug: "github-actions",
    completedAt: "2026-10-25T10:10:00Z",
    ...overrides,
  };
}

function data(overrides: Partial<RepoData> = {}): RepoData {
  return { issues: [issue()], pulls: [], comments: [], pullChecks: {}, events: [], ...overrides };
}

/** マージ待ち・ai:hold（人間がマージを押す） */
function mergeWaiting(checkRuns: CheckRunData[] = [check()], pullOverrides: Partial<PullData> = {}) {
  return data({
    pulls: [pull(pullOverrides)],
    pullChecks: { 10: { checkRuns, statuses: [] } },
  });
}

type Call = { method: string; url: string; body: unknown };

/** 呼ばれたリクエストを記録する、偽のGitHub */
function fakeClient(respond: (call: Call) => Response = () => new Response(null, { status: 204 })) {
  const calls: Call[] = [];
  const client = new GitHubClient(TOKEN, async (url, init) => {
    const call: Call = {
      method: init?.method ?? "GET",
      url: String(url),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    return respond(call);
  });
  return { client, calls };
}

function input(kind: OperationInput["kind"], issueNumber = 1): OperationInput {
  return { kind, owner: "o", repo: "r", issueNumber };
}

describe("parseOperationInput", () => {
  it("正しい形だけ通す", () => {
    expect(parseOperationInput({ kind: "merge", owner: "o", repo: "r", issueNumber: 3 })).toEqual({
      kind: "merge",
      owner: "o",
      repo: "r",
      issueNumber: 3,
    });
  });

  it.each([
    null,
    "merge",
    { kind: "delete", owner: "o", repo: "r", issueNumber: 3 },
    { kind: "merge", owner: "o/../x", repo: "r", issueNumber: 3 },
    { kind: "merge", owner: "o", repo: "r", issueNumber: 0 },
    { kind: "merge", owner: "o", repo: "r", issueNumber: 1.5 },
    { kind: "merge", owner: "o", repo: "r", issueNumber: "3" },
    { kind: "answer", owner: "o", repo: "r", issueNumber: 3 },
    { kind: "answer", owner: "o", repo: "r", issueNumber: 3, answer: "  " },
    { kind: "answer", owner: "o", repo: "r", issueNumber: 3, answer: 1 },
    { kind: "answer", owner: "o", repo: "r", issueNumber: 3, answer: "あ".repeat(4001) },
  ])("%j は通さない", (value) => {
    expect(parseOperationInput(value)).toBeNull();
  });

  it("答えを送る：答えの文も一緒に通す（ほかの操作では答えの文を持たない）", () => {
    expect(parseOperationInput({ kind: "answer", owner: "o", repo: "r", issueNumber: 3, answer: "A。Q1はB" })).toEqual({
      kind: "answer",
      owner: "o",
      repo: "r",
      issueNumber: 3,
      answer: "A。Q1はB",
    });
    expect(parseOperationInput({ kind: "plan", owner: "o", repo: "r", issueNumber: 3, answer: "x" })).toEqual({
      kind: "plan",
      owner: "o",
      repo: "r",
      issueNumber: 3,
    });
  });
});

describe("答えを送る", () => {
  const question = {
    id: 5,
    issueNumber: 1,
    author: "claude[bot]",
    body: "<!-- ai-question -->\n**Q1. 色は？**\n- A. 明るい（おすすめ）\n- B. 暗い",
    createdAt: "2026-10-25T10:00:00Z",
  };
  const asking = () => data({ issues: [issue({ labels: ["ai:question"] })], comments: [question] });

  it("質問のIssueに、答えの文をコメントで書く", async () => {
    const { client, calls } = fakeClient(() => Response.json({ id: 1 }, { status: 201 }));
    const result = await executeOperation(
      client,
      TARGET,
      { ...input("answer"), answer: "Q1はA（明るい）" },
      asking(),
      NOW,
    );
    expect(result).toEqual({ ok: true });
    expect(calls).toEqual([
      {
        method: "POST",
        url: "https://api.github.com/repos/o/r/issues/1/comments",
        body: { body: "Q1はA（明るい）" },
      },
    ]);
  });

  it("保留の質問に答えると、コメントのあと ai:skip を外して ai:plan を付ける", async () => {
    const { client, calls } = fakeClient(() => Response.json({ id: 1 }, { status: 201 }));
    const held = data({ issues: [issue({ labels: ["ai:skip"] })], comments: [question] });
    const result = await executeOperation(client, TARGET, { ...input("answer"), answer: "Q1はA" }, held, NOW);
    expect(result).toEqual({ ok: true });
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      "POST https://api.github.com/repos/o/r/issues/1/comments",
      "DELETE https://api.github.com/repos/o/r/issues/1/labels/ai%3Askip",
      "POST https://api.github.com/repos/o/r/issues/1/labels",
    ]);
    expect(calls[2].body).toEqual({ labels: ["ai:plan"] });
  });

  it("ai:skip が無い質問の答えは、ラベルを変えない", async () => {
    const { client, calls } = fakeClient(() => Response.json({ id: 1 }, { status: 201 }));
    await executeOperation(client, TARGET, { ...input("answer"), answer: "Q1はA" }, asking(), NOW);
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      "POST https://api.github.com/repos/o/r/issues/1/comments",
    ]);
  });

  it("もう答えてある・質問でなくなっていたら、何もせず取り直す", async () => {
    const { client, calls } = fakeClient();
    const answered = asking();
    answered.comments.push({ ...question, id: 6, author: TARGET.owner, body: "A", createdAt: "2026-10-25T11:00:00Z" });
    expect(await executeOperation(client, TARGET, { ...input("answer"), answer: "B" }, answered, NOW)).toEqual({
      ok: false,
      changed: true,
    });
    expect(await executeOperation(client, TARGET, { ...input("answer"), answer: "B" }, data(), NOW)).toEqual({
      ok: false,
      changed: true,
    });
    expect(calls).toEqual([]);
  });

  it("答えの文が無ければ送らない", async () => {
    const { client, calls } = fakeClient();
    const result = await executeOperation(client, TARGET, input("answer"), asking(), NOW);
    expect(result).toEqual({ ok: false, changed: false, message: OPERATION_MESSAGES.invalid });
    expect(calls).toEqual([]);
  });
});

describe("工場の相談に答える", () => {
  const talk = {
    id: 5,
    issueNumber: 1,
    author: "github-actions[bot]",
    body: encodeFactoryMark({ stage: "mocks", mocks: [{ key: "a", title: "A" }] }),
    createdAt: "2026-10-25T10:00:00Z",
  };
  const factory = () =>
    data({
      isTemplate: true,
      issues: [issue({ title: "新サービス：天気", labels: ["factory", "factory:talk", "factory:wait"] })],
      comments: [talk],
    });

  it("factory:wait の「新サービス：」のIssueに、印つきの答えをコメントで書く", async () => {
    const { client, calls } = fakeClient(() => Response.json({ id: 1 }, { status: 201 }));
    const answer = `画面Aを選ぶ\n\n<!-- factory-answer:${encodeBase64('{"action":"pick","choice":"a","answers":[],"note":""}')} -->`;
    expect(await executeOperation(client, TARGET, { ...input("answer"), answer }, factory(), NOW)).toEqual({ ok: true });
    expect(calls.map((c) => [c.method, c.url, c.body])).toEqual([
      ["POST", "https://api.github.com/repos/o/r/issues/1/comments", { body: answer }],
    ]);
  });

  it("印が読めない答えは送らない（印の無い文は送る）", async () => {
    const { client, calls } = fakeClient(() => Response.json({ id: 1 }, { status: 201 }));
    const broken = `A\n\n<!-- factory-answer:${encodeBase64('{"action":"back"}')} -->`;
    expect(await executeOperation(client, TARGET, { ...input("answer"), answer: broken }, factory(), NOW)).toEqual({
      ok: false,
      changed: false,
      message: OPERATION_MESSAGES.invalid,
    });
    expect(calls).toEqual([]);
    expect(await executeOperation(client, TARGET, { ...input("answer"), answer: "A で" }, factory(), NOW)).toEqual({ ok: true });
  });

  it("factory:wait が外れた（工場が受け取った）・答え済みなら、何もせず取り直す", async () => {
    const { client, calls } = fakeClient();
    const waiting = factory();
    const removed = { ...waiting, issues: [issue({ title: "新サービス：天気", labels: ["factory", "factory:talk"] })] };
    expect(await executeOperation(client, TARGET, { ...input("answer"), answer: "A" }, removed, NOW)).toEqual({
      ok: false,
      changed: true,
    });
    const answered = factory();
    answered.comments.push({ ...talk, id: 6, author: TARGET.owner, body: "A", createdAt: "2026-10-25T11:00:00Z" });
    expect(await executeOperation(client, TARGET, { ...input("answer"), answer: "A" }, answered, NOW)).toEqual({
      ok: false,
      changed: true,
    });
    expect(calls).toEqual([]);
  });
});

describe("authorizeOperation", () => {
  const base = {
    login: "Gaku1205",
    token: TOKEN,
    allowedLogins: ["gaku1205"],
    watched: WATCHED,
    owner: "o",
    repo: "r",
  };

  it("ログイン中・許可リスト・監視リポジトリなら通す（設定に書かれた表記で返す）", () => {
    const result = authorizeOperation({ ...base, owner: "O", repo: "R" });
    expect(result).toEqual({ ok: true, target: TARGET, token: TOKEN });
  });

  it("ログインしていなければ拒否する", () => {
    expect(authorizeOperation({ ...base, login: null })).toEqual({
      ok: false,
      message: OPERATION_MESSAGES.unauthorized,
    });
    expect(authorizeOperation({ ...base, token: null }).ok).toBe(false);
  });

  it("許可リスト外のユーザーは拒否する", () => {
    expect(authorizeOperation({ ...base, login: "someone" }).ok).toBe(false);
    expect(authorizeOperation({ ...base, allowedLogins: [] }).ok).toBe(false);
  });

  it("監視していないリポジトリは拒否する", () => {
    expect(authorizeOperation({ ...base, repo: "secret" })).toEqual({
      ok: false,
      message: OPERATION_MESSAGES.notWatched,
    });
  });
});

describe("executeOperation", () => {
  it("おまかせ：Issueに ai:plan を付ける", async () => {
    const { client, calls } = fakeClient();
    const result = await executeOperation(client, TARGET, input("plan"), data(), NOW);
    expect(result).toEqual({ ok: true });
    expect(calls).toEqual([
      {
        method: "POST",
        url: "https://api.github.com/repos/o/r/issues/1/labels",
        body: { labels: ["ai:plan"] },
      },
    ]);
  });

  it("実装を依頼：Issueに ai:implement を付ける", async () => {
    const { client, calls } = fakeClient();
    await executeOperation(client, TARGET, input("implement"), data(), NOW);
    expect(calls[0].body).toEqual({ labels: ["ai:implement"] });
  });

  it("再開：IssueとPRから ai:stuck を外す", async () => {
    const { client, calls } = fakeClient();
    const repoData = data({
      issues: [issue({ labels: ["ai:stuck"] })],
      pulls: [pull({ labels: ["ai:stuck"] })],
      pullChecks: { 10: { checkRuns: [], statuses: [] } },
    });
    expect(await executeOperation(client, TARGET, input("resume"), repoData, NOW)).toEqual({
      ok: true,
    });
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      "DELETE https://api.github.com/repos/o/r/issues/1/labels/ai%3Astuck",
      "DELETE https://api.github.com/repos/o/r/issues/10/labels/ai%3Astuck",
    ]);
  });

  it("始める：Issueから ai:skip を外す（ai:plan は付けない）", async () => {
    const { client, calls } = fakeClient();
    const repoData = data({ issues: [issue({ labels: ["ai:skip"] })] });
    expect(await executeOperation(client, TARGET, input("start"), repoData, NOW)).toEqual({ ok: true });
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      "DELETE https://api.github.com/repos/o/r/issues/1/labels/ai%3Askip",
    ]);
  });

  it("始める：保留でなくなっていたら何もせず取り直す", async () => {
    const { client, calls } = fakeClient();
    const repoData = data({ issues: [issue({ labels: ["ai:plan"] })] });
    expect(await executeOperation(client, TARGET, input("start"), repoData, NOW)).toEqual({
      ok: false,
      changed: true,
    });
    expect(calls).toEqual([]);
  });

  it("PRを作る：claude/issue-<番号>- のブランチから main へ", async () => {
    const { client, calls } = fakeClient((call) =>
      call.method === "GET"
        ? Response.json([
            { ref: "refs/heads/claude/issue-1-20261025-1000" },
            { ref: "refs/heads/claude/issue-1-20261025-1200" },
          ])
        : Response.json({ number: 11 }, { status: 201 }),
    );
    const repoData = data({
      comments: [
        { id: 1, issueNumber: 1, author: "claude[bot]", body: "Claude finished", createdAt: NOW.toISOString() },
      ],
    });
    expect(await executeOperation(client, TARGET, input("createPull"), repoData, NOW)).toEqual({
      ok: true,
    });
    expect(calls[0].url).toBe(
      "https://api.github.com/repos/o/r/git/matching-refs/heads/claude/issue-1-",
    );
    expect(calls[1]).toEqual({
      method: "POST",
      url: "https://api.github.com/repos/o/r/pulls",
      body: {
        head: "claude/issue-1-20261025-1200",
        base: "main",
        title: "あなたの番",
        body: "Closes #1",
      },
    });
  });

  it("PRを作る：ブランチが無ければ理由を返す", async () => {
    const { client } = fakeClient(() => Response.json([]));
    const repoData = data({
      comments: [
        { id: 1, issueNumber: 1, author: "claude[bot]", body: "Claude finished", createdAt: NOW.toISOString() },
      ],
    });
    expect(await executeOperation(client, TARGET, input("createPull"), repoData, NOW)).toEqual({
      ok: false,
      changed: false,
      message: OPERATION_MESSAGES.noBranch,
    });
  });

  it("レビューを依頼：PRに ai:review を付ける", async () => {
    const { client, calls } = fakeClient();
    await executeOperation(client, TARGET, input("requestReview"), mergeWaiting(), NOW);
    expect(calls[0]).toEqual({
      method: "POST",
      url: "https://api.github.com/repos/o/r/issues/10/labels",
      body: { labels: ["ai:review"] },
    });
  });

  it("その段階で出ない操作は、何もせず changed を返す", async () => {
    const { client, calls } = fakeClient();
    expect(await executeOperation(client, TARGET, input("merge"), data(), NOW)).toEqual({
      ok: false,
      changed: true,
    });
    expect(await executeOperation(client, TARGET, input("plan", 99), data(), NOW)).toEqual({
      ok: false,
      changed: true,
    });
    expect(calls).toEqual([]);
  });

  it("画面案を作っている間（ai:mocks）は、おまかせ・実装を依頼を受け付けない", async () => {
    const { client, calls } = fakeClient();
    const mocks = data({ issues: [issue({ labels: ["ai:mocks"] })] });
    expect(await executeOperation(client, TARGET, input("plan"), mocks, NOW)).toEqual({ ok: false, changed: true });
    expect(await executeOperation(client, TARGET, input("implement"), mocks, NOW)).toEqual({ ok: false, changed: true });
    expect(calls).toEqual([]);
  });

  it("GitHubが失敗したら、理由を返す（トークンは含めない）", async () => {
    const { client } = fakeClient(() => new Response(`bad ${TOKEN}`, { status: 403 }));
    const result = await executeOperation(client, TARGET, input("plan"), data(), NOW);
    expect(result).toEqual({ ok: false, changed: false, message: OPERATION_MESSAGES.forbidden });
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });
});

describe("マージ", () => {
  it("マージできるときは、確かめた先頭コミットを付けてマージする", async () => {
    const { client, calls } = fakeClient(() => Response.json({ merged: true }));
    expect(await executeOperation(client, TARGET, input("merge"), mergeWaiting(), NOW)).toEqual({
      ok: true,
    });
    expect(calls).toEqual([
      {
        method: "PUT",
        url: "https://api.github.com/repos/o/r/pulls/10/merge",
        body: { sha: "abc123" },
      },
    ]);
  });

  it.each<[string, RepoData]>([
    ["CIが始まった", mergeWaiting([check({ status: "in_progress", conclusion: null })])],
    ["CIが失敗した", mergeWaiting([check({ conclusion: "failure" })])],
    [
      "レビュー中になった",
      mergeWaiting([check()], { labels: ["ai:hold", "ai:review"] }),
    ],
    ["ai:hold が外れた（AIの番）", mergeWaiting([check()], { labels: [] })],
    [
      "もうマージされた",
      mergeWaiting([check()], { state: "closed", merged: true, mergedAt: "2026-10-25T11:59:00Z" }),
    ],
  ])("%s ときは、エラーを出さずに changed を返す", async (_name, repoData) => {
    const { client, calls } = fakeClient();
    expect(await executeOperation(client, TARGET, input("merge"), repoData, NOW)).toEqual({
      ok: false,
      changed: true,
    });
    expect(calls).toEqual([]);
  });

  it.each([405, 409])("GitHubが %i（マージできない・先頭が変わった）なら changed", async (status) => {
    const { client } = fakeClient(() => Response.json({ message: "x" }, { status }));
    expect(await executeOperation(client, TARGET, input("merge"), mergeWaiting(), NOW)).toEqual({
      ok: false,
      changed: true,
    });
  });

  it("それ以外の失敗は、理由を返す", async () => {
    const { client } = fakeClient(() => Response.json({ message: "x" }, { status: 500 }));
    expect(await executeOperation(client, TARGET, input("merge"), mergeWaiting(), NOW)).toEqual({
      ok: false,
      changed: false,
      message: OPERATION_MESSAGES.failed,
    });
  });
});

describe("Issueに紐づかないPRのマージ", () => {
  const review = {
    id: 1,
    issueNumber: 50,
    author: "claude[bot]",
    body: "## Code review\n\nNo issues found.",
    createdAt: "2026-10-25T10:05:00Z",
  };
  function lone(checkRuns: CheckRunData[] = [check()], pullOverrides: Partial<PullData> = {}) {
    return data({
      issues: [],
      pulls: [pull({ number: 50, body: "手作業のPR", headRef: "manager/readme", headSha: "def456", ...pullOverrides })],
      comments: [review],
      pullChecks: { 50: { checkRuns, statuses: [] } },
    });
  }

  it("条件を満たすPRは、PR番号で送ると先頭コミットを付けてマージする", async () => {
    const { client, calls } = fakeClient(() => Response.json({ merged: true }));
    expect(await executeOperation(client, TARGET, input("merge", 50), lone(), NOW)).toEqual({ ok: true });
    expect(calls).toEqual([
      { method: "PUT", url: "https://api.github.com/repos/o/r/pulls/50/merge", body: { sha: "def456" } },
    ]);
  });

  it.each<[string, RepoData]>([
    ["CIが失敗した", lone([check({ conclusion: "failure" })])],
    ["ai:hold が無い", lone([check()], { labels: [] })],
  ])("%s ときは、何も呼ばずに changed を返す", async (_name, repoData) => {
    const { client, calls } = fakeClient();
    expect(await executeOperation(client, TARGET, input("merge", 50), repoData, NOW)).toEqual({
      ok: false,
      changed: true,
    });
    expect(calls).toEqual([]);
  });

  it.each([405, 409])("GitHubが %i なら changed", async (status) => {
    const { client } = fakeClient(() => Response.json({ message: "x" }, { status }));
    expect(await executeOperation(client, TARGET, input("merge", 50), lone(), NOW)).toEqual({
      ok: false,
      changed: true,
    });
  });
});

describe("operationErrorMessage", () => {
  it("エラーの種類ごとに理由を決める", () => {
    expect(operationErrorMessage(new GitHubError("unauthorized", 401))).toBe(
      OPERATION_MESSAGES.unauthorized,
    );
    expect(operationErrorMessage(new GitHubError("rate_limited", 429))).toBe(
      OPERATION_MESSAGES.rateLimited,
    );
    expect(operationErrorMessage(new Error("boom"))).toBe(OPERATION_MESSAGES.failed);
  });
});

describe("executeCreateIssue", () => {
  const base = { owner: "o", repo: "r", title: "天気のページ", omakase: true, imageUrls: [] };
  const respond = (isTemplate: boolean) => (call: Call) =>
    call.method === "GET"
      ? Response.json({ is_template: isTemplate })
      : Response.json({ number: 7, html_url: "https://github.com/o/r/issues/7" }, { status: 201 });

  it("通常のリポジトリ：メモがタイトルで、ラベルも本文も付けない", async () => {
    const { client, calls } = fakeClient(respond(false));
    expect(await executeCreateIssue(client, TARGET, base)).toEqual({
      ok: true,
      number: 7,
      url: "https://github.com/o/r/issues/7",
    });
    expect(calls[1]).toEqual({
      method: "POST",
      url: "https://api.github.com/repos/o/r/issues",
      body: { title: "天気のページ" },
    });
  });

  it("テンプレート：「新サービス：」付き。全部おまかせなら本文にチェックが入る", async () => {
    const { client, calls } = fakeClient(respond(true));
    await executeCreateIssue(client, TARGET, base);
    expect(calls[1].body).toEqual({ title: "新サービス：天気のページ", body: "- [x] 全部おまかせ" });
    const second = fakeClient(respond(true));
    await executeCreateIssue(second.client, TARGET, { ...base, omakase: false });
    expect(second.calls[1].body).toEqual({ title: "新サービス：天気のページ" });
  });

  it("GitHubの失敗は理由にして返す", async () => {
    const { client } = fakeClient(() => new Response(null, { status: 403 }));
    expect(await executeCreateIssue(client, TARGET, base)).toEqual({
      ok: false,
      message: OPERATION_MESSAGES.forbidden,
    });
  });

  it("画像：上げたURLを本文に1枚1行で並べる", async () => {
    const { client, calls } = fakeClient(respond(false));
    const imageUrls = [
      "https://github.com/o/r/raw/issue-images/images/202611/a.png",
      "https://github.com/o/r/raw/issue-images/images/202611/b.png",
    ];
    await executeCreateIssue(client, TARGET, { ...base, imageUrls });
    expect(calls[1].body).toEqual({
      title: "天気のページ",
      body: imageUrls.map((url) => `![スクショ](${url})`).join("\n"),
    });
  });
});

describe("executeUploadIssueImage", () => {
  const png = { kind: "png" as const, bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]) };

  it("ブランチが無ければ親の無い空のコミットから作り、1枚上げてURLを返す", async () => {
    const { client, calls } = fakeClient((call) => {
      if (call.method === "GET") return new Response(null, { status: 404 });
      if (call.url.endsWith("/git/trees")) return Response.json({ sha: "tree1" }, { status: 201 });
      if (call.url.endsWith("/git/commits")) return Response.json({ sha: "commit1" }, { status: 201 });
      return Response.json({}, { status: 201 });
    });
    const result = await executeUploadIssueImage(client, TARGET, png, NOW);
    const treeCall = calls.find((call) => call.url.endsWith("/git/trees"));
    const sentTree = (treeCall?.body as { tree?: unknown[] } | undefined)?.tree;
    expect(sentTree).toHaveLength(1);
    expect(sentTree?.[0]).toEqual({ path: ".gitkeep", mode: "100644", type: "blob", content: "" });
    const commit = calls.find((call) => call.url.endsWith("/git/commits"));
    expect(commit?.body).toEqual({ message: "画像の置き場所を作る", tree: "tree1", parents: [] });
    const ref = calls.find((call) => call.url.endsWith("/git/refs"));
    expect(ref?.body).toEqual({ ref: "refs/heads/issue-images", sha: "commit1" });
    const puts = calls.filter((call) => call.method === "PUT");
    expect(puts).toHaveLength(1);
    expect(puts[0].url).toMatch(/\/repos\/o\/r\/contents\/images\/202610\/[0-9a-f-]{36}\.png$/);
    expect(puts[0].body).toMatchObject({
      branch: "issue-images",
      content: Buffer.from(png.bytes).toString("base64"),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 返したURLは、Issueを作るときの確かめ直しを通る形
    expect(parseImageUrls("o", "r", [result.url])).toEqual([result.url]);
    expect(JSON.stringify(calls)).not.toContain(TOKEN);
  });

  it("ブランチがあればそのまま使う", async () => {
    const { client, calls } = fakeClient((call) =>
      call.method === "GET" ? Response.json({ ref: "refs/heads/issue-images" }) : Response.json({}, { status: 201 }),
    );
    expect((await executeUploadIssueImage(client, TARGET, png, NOW)).ok).toBe(true);
    expect(calls.some((call) => call.url.endsWith("/git/commits"))).toBe(false);
  });

  it("上げられなければ固定文を返す（ログイン切れはその文）", async () => {
    const failing = fakeClient((call) => (call.method === "PUT" ? new Response(null, { status: 500 }) : Response.json({})));
    expect(await executeUploadIssueImage(failing.client, TARGET, png, NOW)).toEqual({
      ok: false,
      message: "画像を上げられませんでした。もう一度試してください",
    });
    const expired = fakeClient(() => new Response(null, { status: 401 }));
    expect(await executeUploadIssueImage(expired.client, TARGET, png, NOW)).toEqual({
      ok: false,
      message: OPERATION_MESSAGES.unauthorized,
    });
  });
});
