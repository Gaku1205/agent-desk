"use server";

import { cookies, headers } from "next/headers";
import { getGitHubToken, getSignedInLogin, signIn } from "@/lib/auth";
import { buildAppManifest, manifestFormUrl, requestOrigin } from "@/lib/appManifest";
import { GitHubClient } from "@/lib/github/client";
import {
  checkSetupTarget,
  dispatchDoctor,
  enableDeleteBranch,
  generateSetupRepo,
  readDoctorRun,
  saveClaudeToken,
  saveExistingApp,
  type SetupResult,
} from "@/lib/github/setup";
import { PRIVATE_SCOPE } from "@/lib/loginScope";
import { newSetupState, signSetupState, STATE_COOKIE, STATE_COOKIE_PATH, STATE_TTL_MS } from "@/lib/setupCookie";
import {
  addInstalledRepo,
  checkRepoNameInput,
  INSTALLED_COOKIE,
  parseSetupRepo,
  SETUP_MESSAGES,
  type DoctorRun,
} from "@/lib/setupState";
import { loadWatchedRepos } from "@/lib/watchedRepos";
import { saveWatchedRepos } from "../settings/actions";

// 導入（/setup）の操作（docs/spec.md の「導入」）。全部サーバーで、ログインした人のトークンで行う。
// 秘密鍵・Claude のトークンは、この中の1回の処理だけで扱い、返さない・残さない。

type Session = { login: string; client: GitHubClient };

async function session(): Promise<Session | null> {
  const login = await getSignedInLogin();
  const token = await getGitHubToken();
  if (!login || !token) return null;
  return { login, client: new GitHubClient(token) };
}

const UNAUTHORIZED = { ok: false as const, message: SETUP_MESSAGES.unauthorized };

/** 1. テンプレートから新しいリポジトリを作る */
export async function createSetupRepo(
  name: unknown,
  visibility: unknown,
): Promise<{ ok: true; repo: string } | { ok: false; message: string }> {
  const auth = await session();
  if (!auth) return UNAUTHORIZED;
  const checked = checkRepoNameInput(name);
  if (!checked) return { ok: false, message: SETUP_MESSAGES.invalidName };
  return generateSetupRepo(auth.client, auth.login, checked, visibility === "private");
}

/** 1. 作ってあるリポジトリを使う：確かめてから、その名前を返す */
export async function pickSetupRepo(repo: unknown): Promise<{ ok: true; repo: string } | { ok: false; message: string }> {
  const auth = await session();
  if (!auth) return UNAUTHORIZED;
  const checked = await checkSetupTarget(auth.client, auth.login, repo);
  if (!checked.ok) return checked;
  return { ok: true, repo: `${checked.target.owner}/${checked.target.repo}` };
}

/**
 * 2. App を作る：推測できない `state` を署名つきの Cookie に置き、フォームで送る先と Manifest を返す。
 * 書き込める先（本人の物・テンプレートから作られた物）でなければ何もしない
 */
export async function startAppManifest(
  repo: unknown,
): Promise<{ ok: true; action: string; manifest: string } | { ok: false; message: string }> {
  const auth = await session();
  if (!auth) return UNAUTHORIZED;
  const checked = await checkSetupTarget(auth.client, auth.login, repo);
  if (!checked.ok) return checked;
  const secret = process.env.AUTH_SECRET;
  const requestHeaders = await headers();
  const origin = requestOrigin({
    authUrl: process.env.AUTH_URL ?? null,
    host: requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host"),
    proto: requestHeaders.get("x-forwarded-proto"),
  });
  if (!secret || !origin) return { ok: false, message: SETUP_MESSAGES.appFailed };
  const name = `${checked.target.owner}/${checked.target.repo}`;
  const state = newSetupState();
  (await cookies()).set(STATE_COOKIE, signSetupState({ state, repo: name, nowMs: Date.now(), secret }), {
    httpOnly: true,
    sameSite: "lax",
    secure: origin.startsWith("https://"),
    path: STATE_COOKIE_PATH,
    maxAge: STATE_TTL_MS / 1000,
  });
  return {
    ok: true,
    action: manifestFormUrl(state),
    manifest: JSON.stringify(buildAppManifest({ login: auth.login, origin, repo: name })),
  };
}

async function rememberInstalled(repo: string): Promise<void> {
  const store = await cookies();
  store.set(INSTALLED_COOKIE, addInstalledRepo(store.get(INSTALLED_COOKIE)?.value, repo), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 365 * 24 * 60 * 60,
  });
}

/** 2. `入れてある`：このリポジトリに App を入れたと覚える（秘密ではない。本人の画面の進み方だけに効く） */
export async function confirmAppInstalled(repo: unknown): Promise<SetupResult> {
  const auth = await session();
  if (!auth) return UNAUTHORIZED;
  const checked = await checkSetupTarget(auth.client, auth.login, repo);
  if (!checked.ok) return checked;
  await rememberInstalled(`${checked.target.owner}/${checked.target.repo}`);
  return { ok: true };
}

/** 2. `App はもう持っている`：App ID と秘密鍵を確かめて書き、すぐ捨てる */
export async function saveExistingAppKeys(repo: unknown, appId: unknown, pem: unknown): Promise<SetupResult> {
  const auth = await session();
  if (!auth) return UNAUTHORIZED;
  const result = await saveExistingApp({ client: auth.client, login: auth.login, repo: String(repo), appId, pem });
  if (!result.ok) return result;
  const parsed = parseSetupRepo(repo);
  if (result.installed && parsed) await rememberInstalled(`${parsed.owner}/${parsed.repo}`);
  return { ok: true };
}

/** 3. Claude のトークンを Secret に書く（値は返さない） */
export async function saveSetupClaudeToken(repo: unknown, token: unknown): Promise<SetupResult> {
  const auth = await session();
  if (!auth) return UNAUTHORIZED;
  return saveClaudeToken({ client: auth.client, login: auth.login, repo: String(repo), token });
}

/** 4. マージ後のブランチを自動で消す */
export async function enableSetupDeleteBranch(repo: unknown): Promise<SetupResult> {
  const auth = await session();
  if (!auth) return UNAUTHORIZED;
  return enableDeleteBranch(auth.client, auth.login, String(repo));
}

/** 5. Doctor を動かす */
export async function startSetupDoctor(repo: unknown): Promise<SetupResult> {
  const auth = await session();
  if (!auth) return UNAUTHORIZED;
  return dispatchDoctor(auth.client, auth.login, String(repo));
}

export type DoctorPoll =
  | { ok: true; run: DoctorRun | null; watchError: string | null }
  | { ok: false; message: string };

/**
 * 5. Doctor の結果を読む（`sinceMs` より後に作られた実行だけ）。✓ なら監視に足す（もう入っていれば何もしない）
 */
export async function pollSetupDoctor(repo: unknown, sinceMs: unknown): Promise<DoctorPoll> {
  const auth = await session();
  if (!auth) return UNAUTHORIZED;
  const checked = await checkSetupTarget(auth.client, auth.login, repo);
  if (!checked.ok) return checked;
  const since = typeof sinceMs === "number" && Number.isFinite(sinceMs) ? sinceMs : null;
  const run = await readDoctorRun(auth.client, checked.target, since);
  if (run?.status !== "success") return { ok: true, run, watchError: null };
  return { ok: true, run, watchError: await addToWatched(checked.target) };
}

/** 監視に足す（今の `saveWatchedRepos`）。失敗したら理由の文、成功・もう入っていれば null */
async function addToWatched(target: { owner: string; repo: string }): Promise<string | null> {
  const { repos } = await loadWatchedRepos();
  const key = `${target.owner}/${target.repo}`.toLowerCase();
  if (repos.some((repo) => `${repo.owner}/${repo.repo}`.toLowerCase() === key)) return null;
  const result = await saveWatchedRepos([...repos.map((repo) => `${repo.owner}/${repo.repo}`), `${target.owner}/${target.repo}`]);
  return result.ok ? null : `${SETUP_MESSAGES.watchFailed}${result.message}`;
}

/** `権限を足してログインし直す`：このページから押したときだけ `read:user repo` で頼む */
export async function reloginWithRepoScope(repo: unknown): Promise<void> {
  const parsed = parseSetupRepo(repo);
  const back = parsed ? `/setup?repo=${parsed.owner}/${parsed.repo}` : "/setup";
  await signIn("github", { redirectTo: back }, { scope: PRIVATE_SCOPE });
}
