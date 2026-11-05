import { describe, expect, it } from "vitest";
import { GitHubClient } from "./github/client";
import { GitHubError } from "./github/errors";
import { encodeBase64, encodeFactoryMark } from "./factoryTalk";
import type { CheckRunData, IssueData, PullData, RepoData } from "./github/types";
import {
  authorizeOperation,
  executeOperation,
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

  it("もう答えてある・質問でなくなっていたら、何もせず取り直す", async () => {
    const { client, calls } = fakeClient();
    const answered = asking();
    answered.comments.push({ ...question, id: 6, author: "owner", body: "A", createdAt: "2026-10-25T11:00:00Z" });
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
    answered.comments.push({ ...talk, id: 6, author: "owner", body: "A", createdAt: "2026-10-25T11:00:00Z" });
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
