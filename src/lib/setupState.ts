// 導入（/setup）の段の決まり（docs/spec.md の「導入」）。入力から出力が決まる関数だけを置く。

/** パイプラインのテンプレート。導入で書き込めるのは、ここから作られたリポジトリだけ */
export const SETUP_TEMPLATE = "Gaku1205/ai-dev-template";

/** パイプラインが読む Secret・Variable の名前 */
export const APP_ID_VARIABLE = "PIPELINE_APP_ID";
export const APP_SLUG_VARIABLE = "PIPELINE_APP_SLUG";
export const APP_KEY_SECRET = "PIPELINE_APP_PRIVATE_KEY";
export const CLAUDE_TOKEN_SECRET = "CLAUDE_CODE_OAUTH_TOKEN";

/** 診断のワークフロー */
export const DOCTOR_WORKFLOW = "doctor.yml";

export const SETUP_MESSAGES = {
  unauthorized: "ログインし直してください",
  notTarget: "このリポジトリは使えません（自分のアカウントにあり、ai-dev-template から作ったリポジトリだけ）",
  invalidName: "リポジトリの名前は、英数字と . _ - の100文字までにしてください",
  exists: "その名前のリポジトリはもうあります",
  createFailed: "リポジトリを作れませんでした",
  appFailed: "App を作れませんでした。もう一度試してください",
  state: "もう一度 App を作るところからやり直してください",
  appKey: "App ID と秘密鍵を確かめてください",
  saveFailed: "保存できませんでした",
  emptyToken: "トークンを貼ってください",
  doctorFailed: "診断を始められませんでした",
  watchFailed: "監視に足せませんでした：",
  noTemplateRepos: "テンプレートから作ったリポジトリがありません",
} as const;

/** `?error=…` で受け取る知らせ（決まった物だけ。それ以外は出さない） */
export function setupErrorMessage(code: unknown): string | null {
  if (code === "state") return SETUP_MESSAGES.state;
  if (code === "app") return SETUP_MESSAGES.appFailed;
  if (code === "target") return SETUP_MESSAGES.notTarget;
  if (code === "auth") return SETUP_MESSAGES.unauthorized;
  return null;
}

const NAME = /^[A-Za-z0-9._-]{1,100}$/;

/** 新しいリポジトリの名前（`owner/` は付けない）。前後の空白は外す。形が違えば null */
export function checkRepoNameInput(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim();
  if (!NAME.test(name) || name === "." || name === "..") return null;
  return name;
}

/** `owner/name` を読む。形が違えば null */
export function parseSetupRepo(value: unknown): { owner: string; repo: string } | null {
  if (typeof value !== "string") return null;
  const parts = value.trim().split("/");
  if (parts.length !== 2) return null;
  const [owner, repo] = parts;
  if (!/^[A-Za-z0-9-]{1,39}$/.test(owner) || !checkRepoNameInput(repo)) return null;
  return { owner, repo };
}

/** `GET /repos/{owner}/{repo}` の返事から、導入で使う物だけを読む */
export type SetupRepoInfo = {
  fullName: string;
  ownerLogin: string;
  template: string | null;
  deleteBranchOnMerge: boolean;
  defaultBranch: string;
};

export function readRepoInfo(raw: unknown): SetupRepoInfo | null {
  if (typeof raw !== "object" || raw === null) return null;
  const repo = raw as {
    full_name?: unknown;
    owner?: { login?: unknown } | null;
    template_repository?: { full_name?: unknown } | null;
    delete_branch_on_merge?: unknown;
    default_branch?: unknown;
  };
  if (typeof repo.full_name !== "string" || typeof repo.owner?.login !== "string") return null;
  const template = repo.template_repository?.full_name;
  return {
    fullName: repo.full_name,
    ownerLogin: repo.owner.login,
    template: typeof template === "string" ? template : null,
    deleteBranchOnMerge: repo.delete_branch_on_merge === true,
    defaultBranch: typeof repo.default_branch === "string" && repo.default_branch !== "" ? repo.default_branch : "main",
  };
}

/** 書き込んでよいリポジトリか：ログインした本人の物で、テンプレートから作られた物（大文字小文字は区別しない） */
export function isSetupTarget(login: string | null, info: SetupRepoInfo | null): boolean {
  if (!login || !info) return false;
  return (
    info.ownerLogin.toLowerCase() === login.toLowerCase() &&
    info.template !== null &&
    info.template.toLowerCase() === SETUP_TEMPLATE.toLowerCase()
  );
}

/** 自分のリポジトリのうち、テンプレートから作られた物（`作ってあるリポジトリを使う` の選択肢） */
export function templateReposOf(owned: { name: string; template: string | null }[], login: string): string[] {
  const prefix = `${login.toLowerCase()}/`;
  return owned
    .filter((repo) => repo.template?.toLowerCase() === SETUP_TEMPLATE.toLowerCase())
    .filter((repo) => repo.name.toLowerCase().startsWith(prefix))
    .map((repo) => repo.name);
}

/** ログインのトークンの権限（`X-OAuth-Scopes`）に `repo` があるか */
export function hasRepoScope(header: string | null): boolean {
  if (!header) return false;
  return header
    .split(",")
    .map((scope) => scope.trim())
    .includes("repo");
}

/** Doctor の1回の実行 */
export type DoctorRun = {
  status: "running" | "success" | "failure";
  url: string | null;
  createdAt: string;
};

/**
 * Doctor の実行の一覧（`GET …/workflows/doctor.yml/runs` の返事）から、見る1件を選ぶ。
 * `sinceMs` があれば、それより後に作られた物だけ（押す前の古い結果を出さない）。いちばん新しい物
 */
export function pickDoctorRun(raw: unknown, sinceMs: number | null = null): DoctorRun | null {
  const runs = (raw as { workflow_runs?: unknown } | null)?.workflow_runs;
  if (!Array.isArray(runs)) return null;
  let best: { run: DoctorRun; at: number } | null = null;
  for (const item of runs as Array<{
    status?: unknown;
    conclusion?: unknown;
    html_url?: unknown;
    created_at?: unknown;
  } | null>) {
    if (typeof item?.created_at !== "string") continue;
    const at = Date.parse(item.created_at);
    if (Number.isNaN(at)) continue;
    if (sinceMs !== null && at < sinceMs) continue;
    const status: DoctorRun["status"] =
      item.status !== "completed" ? "running" : item.conclusion === "success" ? "success" : "failure";
    const run: DoctorRun = {
      status,
      url: typeof item.html_url === "string" && item.html_url.startsWith("https://github.com/") ? item.html_url : null,
      createdAt: item.created_at,
    };
    if (!best || at > best.at) best = { run, at };
  }
  return best?.run ?? null;
}

/** 段の状態を決めるために、GitHub から取った事実 */
export type SetupFacts = {
  /** `?repo=` で開いたリポジトリ（無ければ null） */
  repo: string | null;
  /** そのリポジトリが、書き込んでよい物か（本人の物で、テンプレートから作られた） */
  repoReady: boolean;
  hasAppId: boolean;
  hasAppKey: boolean;
  /** App の名前（`PIPELINE_APP_SLUG`）。無ければ null */
  appSlug: string | null;
  /** App をこのリポジトリに入れたか（戻ってきた印・`入れてある`・鍵での確認） */
  appInstalled: boolean;
  hasClaudeToken: boolean;
  deleteBranchOnMerge: boolean;
  /** 最後の Doctor の実行（無ければ null） */
  doctor: DoctorRun | null;
};

export const EMPTY_FACTS: SetupFacts = {
  repo: null,
  repoReady: false,
  hasAppId: false,
  hasAppKey: false,
  appSlug: null,
  appInstalled: false,
  hasClaudeToken: false,
  deleteBranchOnMerge: false,
  doctor: null,
};

export const SETUP_STEP_IDS = ["repo", "app", "claude", "settings", "check"] as const;
export type SetupStepId = (typeof SETUP_STEP_IDS)[number];
export type SetupStepStatus = "done" | "current" | "todo";

export type SetupSteps = {
  status: Record<SetupStepId, SetupStepStatus>;
  /** 今の段（全部済んだら null） */
  current: SetupStepId | null;
  /** App の段の中で、次にすること（作る／このリポジトリに入れる） */
  appPhase: "create" | "install";
};

function stepDone(id: SetupStepId, facts: SetupFacts): boolean {
  switch (id) {
    case "repo":
      return facts.repo !== null && facts.repoReady;
    case "app":
      return facts.hasAppId && facts.hasAppKey && facts.appInstalled;
    case "claude":
      return facts.hasClaudeToken;
    case "settings":
      return facts.deleteBranchOnMerge;
    case "check":
      return facts.doctor?.status === "success";
  }
}

/** 取った事実 → 各段の 済み／今／まだ。上から見て最初の済んでいない段が今、それより下は全部まだ */
export function computeSetupSteps(facts: SetupFacts): SetupSteps {
  const status = {} as Record<SetupStepId, SetupStepStatus>;
  let current: SetupStepId | null = null;
  for (const id of SETUP_STEP_IDS) {
    if (current !== null) status[id] = "todo";
    else if (stepDone(id, facts)) status[id] = "done";
    else {
      status[id] = "current";
      current = id;
    }
  }
  return { status, current, appPhase: facts.hasAppId && facts.hasAppKey ? "install" : "create" };
}

/** 「入れた」を覚える Cookie の値（小文字の `owner/name` のカンマ区切り。新しい物を後ろに、最大20件） */
export const INSTALLED_COOKIE = "agent-desk-setup-installed";
const INSTALLED_MAX = 20;

export function parseInstalledCookie(value: string | undefined | null): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((name) => name.trim().toLowerCase())
    .filter((name) => parseSetupRepo(name) !== null);
}

export function addInstalledRepo(value: string | undefined | null, repo: string): string {
  const key = repo.toLowerCase();
  const list = parseInstalledCookie(value).filter((name) => name !== key);
  list.push(key);
  return list.slice(-INSTALLED_MAX).join(",");
}

export function isInstalledRepo(value: string | undefined | null, repo: string): boolean {
  return parseInstalledCookie(value).includes(repo.toLowerCase());
}
