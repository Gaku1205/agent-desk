import type { WatchedRepo } from "../config";
import { isAppSlug } from "../appManifest";
import { REPO_SETTING_MESSAGES, repoSettingErrorMessage } from "../repoSetting";
import {
  APP_ID_VARIABLE,
  APP_KEY_SECRET,
  APP_SLUG_VARIABLE,
  CLAUDE_TOKEN_SECRET,
  DOCTOR_WORKFLOW,
  EMPTY_FACTS,
  isSetupTarget,
  parseSetupRepo,
  pickDoctorRun,
  readRepoInfo,
  SETUP_MESSAGES,
  SETUP_TEMPLATE,
  type DoctorRun,
  type SetupFacts,
  type SetupRepoInfo,
} from "../setupState";
import { claimManifestCode, isManifestCode, verifySetupState } from "../setupCookie";
import { buildAppJwt, readAppCredentials } from "./appAuth";
import { GitHubClient, type Fetcher } from "./client";
import { GitHubError } from "./errors";
import { listSecretNames, writeSecret } from "./secrets";
import { readVariable, writeVariable } from "./settings";

// 導入（/setup）の GitHub の呼び出し（docs/spec.md の「導入」）。サーバーだけで使う。
// 秘密鍵・Claude のトークンは、この中の1回の処理だけで扱う。保存しない・ログに出さない・返さない・エラーの文に入れない。

const API_BASE = "https://api.github.com";

export type SetupResult = { ok: true } | { ok: false; message: string };

function repoPath({ owner, repo }: WatchedRepo): string {
  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
}

/** GitHub の失敗を、決まった文にする（中身・値は入れない） */
export function setupFailure(error: unknown, fallback: string): string {
  if (error instanceof GitHubError && error.kind !== "other") {
    const message = repoSettingErrorMessage(error);
    return message === REPO_SETTING_MESSAGES.failed ? fallback : message;
  }
  return fallback;
}

/** リポジトリを読む。見つからない・読めなければ null（ほかの失敗は投げる） */
async function readRepo(client: GitHubClient, target: WatchedRepo): Promise<SetupRepoInfo | null> {
  try {
    return readRepoInfo(await client.get<unknown>(repoPath(target)));
  } catch (error) {
    if (error instanceof GitHubError && (error.kind === "not_found" || error.kind === "forbidden")) return null;
    throw error;
  }
}

export type SetupTarget = { ok: true; target: WatchedRepo; info: SetupRepoInfo } | { ok: false; message: string };

/**
 * 書き込む前に、毎回リポジトリを読み直して確かめる：本人のアカウントにあり、テンプレートから作られた物だけ。
 * 違えば何も書かない
 */
export async function checkSetupTarget(client: GitHubClient, login: string, value: unknown): Promise<SetupTarget> {
  const parsed = parseSetupRepo(value);
  if (!parsed) return { ok: false, message: SETUP_MESSAGES.notTarget };
  let info: SetupRepoInfo | null;
  try {
    info = await readRepo(client, parsed);
  } catch (error) {
    return { ok: false, message: setupFailure(error, SETUP_MESSAGES.notTarget) };
  }
  if (!info || !isSetupTarget(login, info)) return { ok: false, message: SETUP_MESSAGES.notTarget };
  const [owner, repo] = info.fullName.split("/");
  return { ok: true, target: { owner, repo }, info };
}

/** ログインのトークンの権限（`X-OAuth-Scopes`）。読めなければ null */
export async function fetchTokenScopes(token: string, fetcher: Fetcher = fetch): Promise<string | null> {
  try {
    const response = await fetcher(`${API_BASE}/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      cache: "no-store",
    });
    if (!response.ok) return null;
    return response.headers.get("x-oauth-scopes");
  } catch {
    return null;
  }
}

/** 最後の Doctor の実行（`sinceMs` より後の物だけ）。ワークフローが無い・読めなければ null */
export async function readDoctorRun(
  client: GitHubClient,
  target: WatchedRepo,
  sinceMs: number | null = null,
): Promise<DoctorRun | null> {
  try {
    const body = await client.get<unknown>(
      `${repoPath(target)}/actions/workflows/${DOCTOR_WORKFLOW}/runs?per_page=${sinceMs === null ? 1 : 5}`,
    );
    return pickDoctorRun(body, sinceMs);
  } catch {
    return null;
  }
}

/**
 * 段の状態を決める事実を GitHub から取る（毎回。データベースは持たない）。
 * 値は読まない：Secret は名前の一覧だけ。読めなかった物は「無い」として扱う
 */
export async function loadSetupFacts(
  client: GitHubClient,
  login: string,
  repoParam: string | null,
  installed: (repo: string) => boolean,
): Promise<{ facts: SetupFacts; notTarget: boolean }> {
  const parsed = parseSetupRepo(repoParam);
  if (!parsed) return { facts: EMPTY_FACTS, notTarget: repoParam !== null && repoParam !== "" };
  const info = await readRepo(client, parsed).catch(() => null);
  if (!info || !isSetupTarget(login, info)) {
    return { facts: { ...EMPTY_FACTS, repo: `${parsed.owner}/${parsed.repo}` }, notTarget: true };
  }
  const [owner, repo] = info.fullName.split("/");
  const target = { owner, repo };
  const [appId, slug, secrets, doctor] = await Promise.all([
    readVariable(client, target, APP_ID_VARIABLE).catch(() => null),
    readVariable(client, target, APP_SLUG_VARIABLE).catch(() => null),
    listSecretNames(client, target).catch(() => [] as string[]),
    readDoctorRun(client, target),
  ]);
  return {
    facts: {
      repo: info.fullName,
      repoReady: true,
      hasAppId: appId !== null && appId.trim() !== "",
      hasAppKey: secrets.includes(APP_KEY_SECRET),
      appSlug: isAppSlug(slug) ? slug : null,
      appInstalled: installed(info.fullName),
      hasClaudeToken: secrets.includes(CLAUDE_TOKEN_SECRET),
      deleteBranchOnMerge: info.deleteBranchOnMerge,
      doctor,
    },
    notTarget: false,
  };
}

/** テンプレートから、ログインした人のアカウントに新しいリポジトリを作る */
export async function generateSetupRepo(
  client: GitHubClient,
  login: string,
  name: string,
  isPrivate: boolean,
): Promise<{ ok: true; repo: string } | { ok: false; message: string }> {
  try {
    const body = (await client.send("POST", `/repos/${SETUP_TEMPLATE}/generate`, {
      owner: login,
      name,
      private: isPrivate,
      include_all_branches: false,
    })) as { full_name?: unknown } | null;
    const fullName = typeof body?.full_name === "string" ? body.full_name : `${login}/${name}`;
    return { ok: true, repo: fullName };
  } catch (error) {
    if (error instanceof GitHubError && error.status === 422) return { ok: false, message: SETUP_MESSAGES.exists };
    return { ok: false, message: setupFailure(error, SETUP_MESSAGES.createFailed) };
  }
}

type AppKeys = { appId: string; slug: string; pem: string };

/** `code` を交換して App ID・slug・秘密鍵を受け取る（ほかの秘密は捨てる）。失敗は null */
export async function convertManifestCode(code: string, fetcher: Fetcher = fetch): Promise<AppKeys | null> {
  try {
    const response = await fetcher(`${API_BASE}/app-manifests/${encodeURIComponent(code)}/conversions`, {
      method: "POST",
      headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
      cache: "no-store",
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { id?: unknown; slug?: unknown; pem?: unknown } | null;
    if (typeof body?.id !== "number" || !isAppSlug(body.slug) || typeof body.pem !== "string" || body.pem === "") {
      return null;
    }
    return { appId: String(body.id), slug: body.slug, pem: body.pem };
  } catch {
    // 原因に返事の中身（鍵）が入りうるので捨てる
    return null;
  }
}

/** 秘密鍵を Secret に、App ID と slug を Variable に書く */
async function writeAppKeys(client: GitHubClient, target: WatchedRepo, keys: AppKeys): Promise<void> {
  await writeSecret(client, target, APP_KEY_SECRET, keys.pem);
  await writeVariable(client, target, APP_ID_VARIABLE, keys.appId);
  await writeVariable(client, target, APP_SLUG_VARIABLE, keys.slug);
}

/**
 * Manifest から戻ってきたとき：リポジトリを確かめ直し、`code` を交換して、その場で書いて捨てる。
 * 返すのは決まった文だけ（鍵は返さない）
 */
export async function completeManifest(input: {
  client: GitHubClient;
  login: string;
  repo: string;
  code: string;
  fetcher?: Fetcher;
}): Promise<SetupResult> {
  const checked = await checkSetupTarget(input.client, input.login, input.repo);
  if (!checked.ok) return checked;
  const keys = await convertManifestCode(input.code, input.fetcher);
  if (!keys) return { ok: false, message: SETUP_MESSAGES.appFailed };
  try {
    await writeAppKeys(input.client, checked.target, keys);
  } catch (error) {
    return { ok: false, message: setupFailure(error, SETUP_MESSAGES.appFailed) };
  }
  return { ok: true };
}

/**
 * Manifest の受け取り口（`/api/setup/app?code&state`）の中身。戻すページのパスを返す。
 * `state` が Cookie と合わない・`code` が2回目なら、GitHub を何も呼ばずに戻す
 */
export async function handleManifestReturn(input: {
  cookie: string | undefined;
  state: string | null;
  code: string | null;
  secret: string | undefined;
  nowMs: number;
  login: string | null;
  client: GitHubClient | null;
  fetcher?: Fetcher;
}): Promise<string> {
  const repo = verifySetupState({ cookie: input.cookie, state: input.state, nowMs: input.nowMs, secret: input.secret });
  if (!repo || !isManifestCode(input.code) || !claimManifestCode(input.code, input.nowMs)) return "/setup?error=state";
  const back = `/setup?repo=${repo}`;
  if (!input.login || !input.client) return `${back}&error=auth`;
  const result = await completeManifest({
    client: input.client,
    login: input.login,
    repo,
    code: input.code,
    fetcher: input.fetcher,
  });
  if (result.ok) return back;
  return `${back}&error=${result.message === SETUP_MESSAGES.notTarget ? "target" : "app"}`;
}

async function appGet(fetcher: Fetcher, jwt: string, path: string): Promise<{ status: number; body: unknown }> {
  try {
    const response = await fetcher(`${API_BASE}${path}`, {
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      cache: "no-store",
    });
    return { status: response.status, body: response.ok ? await response.json() : null };
  } catch {
    return { status: 0, body: null };
  }
}

/**
 * `App はもう持っている`：貼られた App ID と秘密鍵で、App の JWT を作り、ID が合うか・slug と、
 * このリポジトリに入っているかを確かめてから、Secret と Variable に書いて捨てる
 */
export async function saveExistingApp(input: {
  client: GitHubClient;
  login: string;
  repo: string;
  appId: unknown;
  pem: unknown;
  fetcher?: Fetcher;
  nowMs?: number;
}): Promise<{ ok: true; installed: boolean } | { ok: false; message: string }> {
  const appId = typeof input.appId === "string" ? input.appId.trim() : "";
  if (!/^\d{1,12}$/.test(appId) || typeof input.pem !== "string") return { ok: false, message: SETUP_MESSAGES.appKey };
  const credentials = readAppCredentials({ PIPELINE_APP_ID: appId, PIPELINE_APP_PRIVATE_KEY: input.pem });
  if (!credentials) return { ok: false, message: SETUP_MESSAGES.appKey };

  const checked = await checkSetupTarget(input.client, input.login, input.repo);
  if (!checked.ok) return checked;

  const fetcher = input.fetcher ?? fetch;
  const jwt = buildAppJwt(credentials.appId, credentials.privateKey, input.nowMs ?? Date.now());
  const app = await appGet(fetcher, jwt, "/app");
  const body = app.body as { id?: unknown; slug?: unknown } | null;
  if (String(body?.id ?? "") !== appId || !isAppSlug(body?.slug)) return { ok: false, message: SETUP_MESSAGES.appKey };
  const installation = await appGet(fetcher, jwt, `${repoPath(checked.target)}/installation`);

  try {
    await writeAppKeys(input.client, checked.target, { appId, slug: body.slug, pem: input.pem });
  } catch (error) {
    return { ok: false, message: setupFailure(error, SETUP_MESSAGES.saveFailed) };
  }
  return { ok: true, installed: installation.status === 200 };
}

/** Claude のトークンを Secret `CLAUDE_CODE_OAUTH_TOKEN` に書く（値は返さない） */
export async function saveClaudeToken(input: {
  client: GitHubClient;
  login: string;
  repo: string;
  token: unknown;
}): Promise<SetupResult> {
  const token = typeof input.token === "string" ? input.token.trim() : "";
  if (token === "" || token.length > 2000 || /\s/.test(token)) return { ok: false, message: SETUP_MESSAGES.emptyToken };
  const checked = await checkSetupTarget(input.client, input.login, input.repo);
  if (!checked.ok) return checked;
  try {
    await writeSecret(input.client, checked.target, CLAUDE_TOKEN_SECRET, token);
  } catch (error) {
    return { ok: false, message: setupFailure(error, SETUP_MESSAGES.saveFailed) };
  }
  return { ok: true };
}

/** `Automatically delete head branches` をオンにする */
export async function enableDeleteBranch(client: GitHubClient, login: string, repo: string): Promise<SetupResult> {
  const checked = await checkSetupTarget(client, login, repo);
  if (!checked.ok) return checked;
  if (checked.info.deleteBranchOnMerge) return { ok: true };
  try {
    await client.send("PATCH", repoPath(checked.target), { delete_branch_on_merge: true });
  } catch (error) {
    return { ok: false, message: setupFailure(error, SETUP_MESSAGES.saveFailed) };
  }
  return { ok: true };
}

/** Doctor を `workflow_dispatch` で動かす（`ref` は既定のブランチ） */
export async function dispatchDoctor(client: GitHubClient, login: string, repo: string): Promise<SetupResult> {
  const checked = await checkSetupTarget(client, login, repo);
  if (!checked.ok) return checked;
  try {
    await client.send("POST", `${repoPath(checked.target)}/actions/workflows/${DOCTOR_WORKFLOW}/dispatches`, {
      ref: checked.info.defaultBranch,
    });
  } catch (error) {
    return { ok: false, message: setupFailure(error, SETUP_MESSAGES.doctorFailed) };
  }
  return { ok: true };
}
