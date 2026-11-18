// パイプライン用の GitHub App の Manifest（docs/spec.md の「導入」）。
// 権限は docs/pipeline-setup.md の「パイプライン用の GitHub App の作り方」と同じ。

/** App の権限（Actions・Checks・Commit statuses が Read、Contents・Issues・Pull requests・Workflows が Read and write） */
export const PIPELINE_APP_PERMISSIONS = {
  actions: "read",
  checks: "read",
  statuses: "read",
  contents: "write",
  issues: "write",
  pull_requests: "write",
  workflows: "write",
} as const;

/** 受け取り口（GitHub が戻すURL）のパス */
export const MANIFEST_CALLBACK_PATH = "/api/setup/app";
export const INSTALLED_CALLBACK_PATH = "/api/setup/installed";

export type AppManifest = {
  name: string;
  url: string;
  hook_attributes: { url: string; active: boolean };
  redirect_url: string;
  setup_url: string;
  setup_on_update: boolean;
  public: boolean;
  default_permissions: Record<string, string>;
  default_events: string[];
};

/** App の名前の既定（`<ログイン名>-ai-pipeline`。GitHub の App の名前は34文字まで） */
export function defaultAppName(login: string): string {
  return `${login}-ai-pipeline`.slice(0, 34);
}

/** このアプリの URL（末尾の `/` は外す） */
function trimOrigin(origin: string): string {
  return origin.replace(/\/+$/, "");
}

/** Manifest の JSON（フォームの `manifest` に入れる物） */
export function buildAppManifest(input: { login: string; origin: string; repo: string }): AppManifest {
  const origin = trimOrigin(input.origin);
  return {
    name: defaultAppName(input.login),
    url: origin,
    hook_attributes: { url: origin, active: false },
    redirect_url: `${origin}${MANIFEST_CALLBACK_PATH}`,
    setup_url: `${origin}${INSTALLED_CALLBACK_PATH}?repo=${encodeURIComponent(input.repo)}`,
    setup_on_update: true,
    public: false,
    default_permissions: { ...PIPELINE_APP_PERMISSIONS },
    default_events: [],
  };
}

/** Manifest を送る先（ログインした人のアカウントに作る） */
export function manifestFormUrl(state: string): string {
  return `https://github.com/settings/apps/new?state=${encodeURIComponent(state)}`;
}

/** App をリポジトリに入れる画面（戻ってきたとき、どのリポジトリか分かるよう `state` に名前を入れる） */
export function appInstallUrl(slug: string, repo: string): string {
  return `https://github.com/apps/${encodeURIComponent(slug)}/installations/new?state=${encodeURIComponent(repo)}`;
}

/**
 * このアプリの URL（Manifest の戻り先）。`AUTH_URL` があればそれ、無ければリクエストの Host から。
 * Host は `localhost` のときだけ http、ほかは https
 */
export function requestOrigin(input: { authUrl?: string | null; host: string | null; proto: string | null }): string | null {
  if (input.authUrl) {
    try {
      return new URL(input.authUrl).origin;
    } catch {
      // 読めなければ Host から
    }
  }
  const host = input.host?.split(",")[0].trim();
  if (!host || !/^[A-Za-z0-9.-]+(:\d+)?$/.test(host)) return null;
  const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
  const proto = local ? (input.proto === "https" ? "https" : "http") : "https";
  return `${proto}://${host}`;
}

/** Claude のアプリを入れる画面 */
export const CLAUDE_APP_INSTALL_URL = "https://github.com/apps/claude/installations/new";

/** App の slug の形（英小文字・数字・`-`） */
export function isAppSlug(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9][a-z0-9-]{0,63}$/.test(value);
}
