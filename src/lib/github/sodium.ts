import { createRequire } from "node:module";

// libsodium-wrappers 0.7.16 の ESM 版（`import`）は、別のパッケージにある `libsodium.mjs` を
// 同じフォルダから読もうとして読み込めない。CommonJS 版（`require`）を使う。サーバーだけで使う。

type Sodium = typeof import("libsodium-wrappers");

const require = createRequire(import.meta.url);

/** 読み込みの済んだ libsodium */
export async function loadSodium(): Promise<Sodium> {
  const sodium = require("libsodium-wrappers") as Sodium;
  await sodium.ready;
  return sodium;
}
