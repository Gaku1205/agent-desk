import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSignedInLogin } from "@/lib/auth";
import { addInstalledRepo, INSTALLED_COOKIE, parseSetupRepo } from "@/lib/setupState";

/**
 * App を入れたあとの戻り先（Manifest の `setup_url`。docs/spec.md の「導入」）。
 * どのリポジトリかは `state`（`owner/name` の形のときだけ）、無ければ `repo`。入れたと覚えて `/setup` へ戻す。
 * 覚えるのは名前だけ（秘密ではない。本人の画面の進み方にだけ効く）
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const repo = parseSetupRepo(url.searchParams.get("state")) ?? parseSetupRepo(url.searchParams.get("repo"));
  if (!repo) return NextResponse.redirect(new URL("/setup", request.url));
  const name = `${repo.owner}/${repo.repo}`;
  const installed = url.searchParams.has("installation_id");
  if (installed && (await getSignedInLogin())) {
    const store = await cookies();
    store.set(INSTALLED_COOKIE, addInstalledRepo(store.get(INSTALLED_COOKIE)?.value, name), {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 365 * 24 * 60 * 60,
    });
  }
  return NextResponse.redirect(new URL(`/setup?repo=${name}`, request.url));
}
