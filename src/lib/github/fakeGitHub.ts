import type { GqlIssue, GqlPull, GqlStatusContext } from "./graphql";

// テスト用：GitHub の GraphQL と REST の偽物。本番のコードからは使わない

export type FakeCall = { method: string; url: string; auth: string | null; variables: Record<string, unknown> | null };

export const ISO = "2026-10-24T00:00:00Z";

export function gqlIssue(number: number, options: Partial<GqlIssue> = {}): GqlIssue {
  return {
    number,
    title: `issue ${number}`,
    body: "",
    state: "OPEN",
    url: `https://github.com/o/r/issues/${number}`,
    createdAt: ISO,
    updatedAt: ISO,
    closedAt: null,
    labels: { nodes: [] },
    comments: { nodes: [] },
    timelineItems: { nodes: [] },
    ...options,
  };
}

export function gqlPull(
  number: number,
  options: Partial<GqlPull> & { merged?: boolean; statuses?: GqlStatusContext[] } = {},
): GqlPull {
  const { merged = false, statuses = [], ...rest } = options;
  return {
    number,
    title: `PR ${number}`,
    body: "",
    state: merged ? "MERGED" : "OPEN",
    url: `https://github.com/o/r/pull/${number}`,
    createdAt: ISO,
    updatedAt: ISO,
    mergedAt: merged ? ISO : null,
    headRefName: `claude/issue-${number}-x`,
    headRefOid: `head-${number}`,
    labels: { nodes: [] },
    comments: { nodes: [] },
    timelineItems: { nodes: [] },
    commits: { nodes: [{ commit: { statusCheckRollup: null } }] },
    mergeCommit: merged ? { oid: `merge-${number}`, status: { contexts: statuses } } : null,
    ...rest,
  };
}

export type FakeRepo = {
  isTemplate?: boolean;
  issues?: GqlIssue[];
  pulls?: GqlPull[];
  /** main の直近のコミット（新しい順）の公開ステータス。null なら main が無い */
  main?: GqlStatusContext[][] | null;
};

const PAGE = 100;

function page<T>(items: T[], after: unknown) {
  const start = typeof after === "string" ? Number(after) : 0;
  const nodes = items.slice(start, start + PAGE);
  const end = start + nodes.length;
  return { pageInfo: { hasNextPage: end < items.length, endCursor: String(end) }, nodes };
}

/** GraphQL の返事（`data`）を、問い合わせの変数（ページ送り・含める物）に合わせて作る */
export function graphqlData(repo: FakeRepo, variables: Record<string, unknown>): unknown {
  const main = repo.main === undefined ? [] : repo.main;
  return {
    rateLimit: { cost: 1, remaining: 4999, resetAt: "2026-10-25T01:00:00Z" },
    repository: {
      isTemplate: repo.isTemplate ?? false,
      ...(variables.withIssues ? { issues: page(repo.issues ?? [], variables.issuesAfter) } : {}),
      ...(variables.withPulls ? { pullRequests: page(repo.pulls ?? [], variables.pullsAfter) } : {}),
      ...(variables.withMain
        ? {
            ref:
              main === null
                ? null
                : {
                    target: {
                      history: {
                        nodes: main.map((contexts, i) => ({ oid: `main-${i}`, status: { contexts } })),
                      },
                    },
                  },
          }
        : {}),
    },
  };
}

export function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    ...init,
    headers: { "content-type": "application/json", ...(init.headers as Record<string, string>) },
  });
}

/**
 * 偽の GitHub。`POST /graphql` は `repos`（キーは `owner/repo`）から答え、REST は `rest` に任せる
 * （無ければ Actions の runs は「1件・実行あり」）。呼ばれた物を `calls` に残す
 */
export function fakeGitHub(
  repos: Record<string, FakeRepo | (() => Response)>,
  rest?: (url: URL) => Response | undefined,
): { fetcher: typeof fetch; calls: FakeCall[] } {
  const calls: FakeCall[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const auth = new Headers(init?.headers).get("authorization");
    if (url.pathname === "/graphql") {
      const body = JSON.parse(String(init?.body)) as { variables: Record<string, unknown> };
      calls.push({ method: "POST", url: url.href, auth, variables: body.variables });
      const repo = repos[`${body.variables.owner}/${body.variables.name}`];
      if (repo === undefined) {
        return jsonResponse({ data: { repository: null }, errors: [{ type: "NOT_FOUND" }] });
      }
      if (typeof repo === "function") return repo();
      return jsonResponse({ data: graphqlData(repo, body.variables) });
    }
    calls.push({ method: init?.method ?? "GET", url: url.href, auth, variables: null });
    const answered = rest?.(url);
    if (answered) return answered;
    if (url.pathname.includes("/actions/workflows/")) {
      return jsonResponse({ total_count: 1, workflow_runs: [{ created_at: ISO }] });
    }
    return jsonResponse({ message: "unexpected" }, { status: 500 });
  };
  return { fetcher, calls };
}
