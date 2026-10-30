import { beforeEach, describe, expect, it } from "vitest";
import { etagCacheForTest } from "./client";
import { deployedStatusCacheForTest, fetchAllRepos, mainDeployedCacheForTest } from "./fetch";

const TOKEN = "ghp_count_test_token";
const NOW = new Date("2026-10-25T00:00:00Z");
const RECENT = "2026-10-24T00:00:00Z";

type RawPull = {
  number: number;
  state: "open" | "closed";
  merged: boolean;
  headRef: string;
  body?: string;
};

function rawPull(pull: RawPull): Record<string, unknown> {
  return {
    number: pull.number,
    title: `PR ${pull.number}`,
    body: pull.body ?? "",
    state: pull.state,
    merged_at: pull.merged ? RECENT : null,
    labels: [],
    html_url: `https://github.com/o/r/pull/${pull.number}`,
    head: { ref: pull.headRef, sha: `head-${pull.number}` },
    merge_commit_sha: pull.merged ? `merge-${pull.number}` : null,
    created_at: RECENT,
    updated_at: RECENT,
  };
}

/** 呼ばれた URL の一覧を残す偽の GitHub。pulls と commit status の中身は引数で決める */
function countingGitHub(pulls: RawPull[], deployed = true) {
  const urls: string[] = [];
  const fetcher: typeof fetch = async (input) => {
    const url = String(input);
    urls.push(url);
    const path = new URL(url).pathname;
    const body = (value: unknown): Response =>
      new Response(JSON.stringify(value), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    if (path.endsWith("/pulls")) return body(pulls.map(rawPull));
    if (path.endsWith("/check-runs")) return body({ check_runs: [] });
    if (path.endsWith("/status")) {
      return body({
        statuses: [
          {
            context: "Vercel",
            state: deployed ? "success" : "pending",
            description: "",
            updated_at: RECENT,
          },
        ],
      });
    }
    if (path.endsWith("/commits")) return body([{ sha: "main-1" }]);
    if (path.includes("/actions/workflows/")) return body({ total_count: 1, workflow_runs: [] });
    if (path.endsWith("/issues") || path.endsWith("/comments") || path.endsWith("/events")) {
      return body([]);
    }
    return body({ is_template: false });
  };
  return { fetcher, urls };
}

const checkRunCalls = (urls: string[]): string[] => urls.filter((url) => url.includes("/check-runs"));
const mergeStatusCalls = (urls: string[]): string[] =>
  urls.filter((url) => /\/commits\/merge-\d+\/status/.test(url));

beforeEach(() => {
  etagCacheForTest.clear();
  mainDeployedCacheForTest.clear();
  deployedStatusCacheForTest.clear();
});

describe("1回の同期で呼ぶAPIの数", () => {
  it("3リポジトリ・PR 100件・開いているPR 5件で、60回以内", async () => {
    const pulls: RawPull[] = [];
    for (let n = 1; n <= 100; n++) {
      if (n <= 5) {
        pulls.push({ number: n, state: "open", merged: false, headRef: `claude/issue-${n}-x` });
      } else if (n <= 9) {
        // マージ済みでIssueに紐づく物は、公開ステータスを1回ずつ取る（覚える前の最初の同期）
        pulls.push({ number: n, state: "closed", merged: true, headRef: `claude/issue-${n}-x` });
      } else if (n <= 60) {
        pulls.push({ number: n, state: "closed", merged: false, headRef: `claude/issue-${n}-x` });
      } else {
        pulls.push({ number: n, state: "closed", merged: true, headRef: `pipeline-sync/${n}` });
      }
    }
    const { fetcher, urls } = countingGitHub(pulls);
    const repos = ["a", "b", "c"].map((repo) => ({ owner: "o", repo }));
    const results = await fetchAllRepos(TOKEN, repos, { fetcher, now: NOW });
    expect(results.every((result) => result.ok)).toBe(true);
    expect(urls.length).toBeLessThanOrEqual(60);
  });
});

describe("チェックを取るPR", () => {
  it("閉じた（未マージ）PRとIssueに紐づかないPRでは check-runs を呼ばない", async () => {
    const { fetcher, urls } = countingGitHub([
      { number: 1, state: "open", merged: false, headRef: "claude/issue-1-x" },
      { number: 2, state: "open", merged: false, headRef: "feature/y", body: "Closes #2" },
      { number: 3, state: "closed", merged: false, headRef: "claude/issue-3-x" },
      { number: 4, state: "open", merged: false, headRef: "pipeline-sync/1" },
    ]);
    const [result] = await fetchAllRepos(TOKEN, [{ owner: "o", repo: "r" }], { fetcher, now: NOW });
    expect(checkRunCalls(urls).map((url) => /head-(\d+)/.exec(url)?.[1])).toEqual(["1", "2"]);
    if (!result.ok) throw new Error("取れるはず");
    expect(Object.keys(result.data.pullChecks).sort()).toEqual(["1", "2"]);
  });

  it("マージ済みPRは、マージコミットの status だけ取る（check-runs は取らない）", async () => {
    const { fetcher, urls } = countingGitHub([
      { number: 7, state: "closed", merged: true, headRef: "claude/issue-7-x" },
      { number: 8, state: "closed", merged: true, headRef: "pipeline-sync/8" },
    ]);
    const [result] = await fetchAllRepos(TOKEN, [{ owner: "o", repo: "r" }], { fetcher, now: NOW });
    expect(checkRunCalls(urls)).toEqual([]);
    expect(mergeStatusCalls(urls)).toHaveLength(1);
    if (!result.ok) throw new Error("取れるはず");
    expect(result.data.pullChecks[7].checkRuns).toEqual([]);
    expect(result.data.pullChecks[7].statuses[0]?.context).toBe("Vercel");
  });
});

describe("公開済みと決まったPRのステータス", () => {
  const merged: RawPull[] = [
    { number: 7, state: "closed", merged: true, headRef: "claude/issue-7-x" },
  ];
  const repos = [{ owner: "o", repo: "r" }];

  it("公開済みなら、2回目の同期でマージコミットの status を呼ばない", async () => {
    const { fetcher, urls } = countingGitHub(merged, true);
    await fetchAllRepos(TOKEN, repos, { fetcher, now: NOW });
    expect(mergeStatusCalls(urls)).toHaveLength(1);
    etagCacheForTest.clear();
    const [second] = await fetchAllRepos(TOKEN, repos, { fetcher, now: NOW });
    expect(mergeStatusCalls(urls)).toHaveLength(1);
    if (!second.ok) throw new Error("取れるはず");
    expect(second.data.pullChecks[7].statuses[0]?.state).toBe("success");
  });

  it("公開中（まだ成功していない）なら、次の同期でも取り直す", async () => {
    const { fetcher, urls } = countingGitHub(merged, false);
    await fetchAllRepos(TOKEN, repos, { fetcher, now: NOW });
    etagCacheForTest.clear();
    await fetchAllRepos(TOKEN, repos, { fetcher, now: NOW });
    expect(mergeStatusCalls(urls)).toHaveLength(2);
  });

  it("覚える物はトークンごと（別のトークンは取り直す）", async () => {
    const { fetcher, urls } = countingGitHub(merged, true);
    await fetchAllRepos(TOKEN, repos, { fetcher, now: NOW });
    await fetchAllRepos("ghp_other_token", repos, { fetcher, now: NOW });
    expect(mergeStatusCalls(urls)).toHaveLength(2);
  });
});
