import { beforeAll, describe, expect, it } from "vitest";
import { GitHubClient } from "./client";
import { listSecretNames, sealSecret, writeSecret } from "./secrets";
import { loadSodium } from "./sodium";

let sodium: Awaited<ReturnType<typeof loadSodium>>;
beforeAll(async () => {
  sodium = await loadSodium();
});

async function keyPair() {
  const pair = sodium.crypto_box_keypair();
  return { ...pair, base64: sodium.to_base64(pair.publicKey, sodium.base64_variants.ORIGINAL) };
}

function open(sealedBase64: string, pair: { publicKey: Uint8Array; privateKey: Uint8Array }): string {
  const sealed = sodium.from_base64(sealedBase64, sodium.base64_variants.ORIGINAL);
  return sodium.to_string(sodium.crypto_box_seal_open(sealed, pair.publicKey, pair.privateKey));
}

describe("sealSecret", () => {
  it("リポジトリの公開鍵の sealed box で、秘密鍵で開くと元の値", async () => {
    const pair = await keyPair();
    const sealed = await sealSecret(pair.base64, "sk-ant-secret");
    expect(sealed).not.toContain("sk-ant-secret");
    expect(open(sealed, pair)).toBe("sk-ant-secret");
  });
});

describe("writeSecret", () => {
  it("公開鍵を取る → 暗号にする → PUT（値そのものは送らない）", async () => {
    const pair = await keyPair();
    const calls: { url: string; method: string; body: string | null }[] = [];
    const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ url: String(url), method, body: typeof init?.body === "string" ? init.body : null });
      if (String(url).endsWith("/actions/secrets/public-key")) {
        return new Response(JSON.stringify({ key_id: "k1", key: pair.base64 }), { status: 200 });
      }
      return new Response(null, { status: 201 });
    }) as typeof fetch;

    await writeSecret(new GitHubClient("t", fetcher), { owner: "Gaku1205", repo: "my-app" }, "CLAUDE_CODE_OAUTH_TOKEN", "tok-123");

    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      "GET https://api.github.com/repos/Gaku1205/my-app/actions/secrets/public-key",
      "PUT https://api.github.com/repos/Gaku1205/my-app/actions/secrets/CLAUDE_CODE_OAUTH_TOKEN",
    ]);
    const body = JSON.parse(calls[1].body ?? "{}") as { encrypted_value: string; key_id: string };
    expect(body.key_id).toBe("k1");
    expect(calls[1].body).not.toContain("tok-123");
    expect(open(body.encrypted_value, pair)).toBe("tok-123");
  });
});

describe("listSecretNames", () => {
  it("名前だけ", async () => {
    const fetcher = (async () =>
      new Response(JSON.stringify({ secrets: [{ name: "A" }, { name: 3 }, { name: "B" }] }), { status: 200 })) as unknown as typeof fetch;
    expect(await listSecretNames(new GitHubClient("t2", fetcher), { owner: "a", repo: "b" })).toEqual(["A", "B"]);
  });
});
