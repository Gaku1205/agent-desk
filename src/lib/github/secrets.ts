import type { WatchedRepo } from "../config";
import type { GitHubClient } from "./client";
import { GitHubError } from "./errors";
import { loadSodium } from "./sodium";

// Actions の Secret を書く（docs/spec.md の「導入」）。GitHub の Secrets API は、
// リポジトリの公開鍵で sealed box にした値しか受け取らない。サーバーだけで使い、値はログ・エラーに出さない。

function repoPath({ owner, repo }: WatchedRepo): string {
  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
}

/** 値を、リポジトリの公開鍵（base64）で sealed box にする（base64 で返す） */
export async function sealSecret(publicKeyBase64: string, value: string): Promise<string> {
  const sodium = await loadSodium();
  const key = sodium.from_base64(publicKeyBase64, sodium.base64_variants.ORIGINAL);
  const sealed = sodium.crypto_box_seal(sodium.from_string(value), key);
  return sodium.to_base64(sealed, sodium.base64_variants.ORIGINAL);
}

/** 公開鍵を取る → sealed box → `PUT …/actions/secrets/{name}` */
export async function writeSecret(client: GitHubClient, target: WatchedRepo, name: string, value: string): Promise<void> {
  const publicKey = await client.get<{ key_id?: unknown; key?: unknown }>(
    `${repoPath(target)}/actions/secrets/public-key`,
  );
  if (typeof publicKey?.key_id !== "string" || typeof publicKey.key !== "string") {
    throw new GitHubError("other");
  }
  let encrypted: string;
  try {
    encrypted = await sealSecret(publicKey.key, value);
  } catch {
    // 原因に値が入りうるので捨てる
    throw new GitHubError("other");
  }
  await client.send("PUT", `${repoPath(target)}/actions/secrets/${encodeURIComponent(name)}`, {
    encrypted_value: encrypted,
    key_id: publicKey.key_id,
  });
}

/** Secret の名前の一覧（値は読まない・読めない） */
export async function listSecretNames(client: GitHubClient, target: WatchedRepo): Promise<string[]> {
  const body = await client.get<{ secrets?: unknown }>(`${repoPath(target)}/actions/secrets?per_page=100`);
  if (!Array.isArray(body?.secrets)) return [];
  return (body.secrets as Array<{ name?: unknown } | null>)
    .map((secret) => secret?.name)
    .filter((name): name is string => typeof name === "string");
}
