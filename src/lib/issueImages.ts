/**
 * Issueに付ける画像（docs/spec.md の「Issueを書く」）の決まり。画面とサーバーの両方で使う純粋関数だけを置く
 */

export type ImageKind = "png" | "jpeg" | "webp" | "gif";

/** 1回に付けられる枚数 */
export const MAX_ISSUE_IMAGES = 5;

/** 1枚の大きさの上限（バイト） */
export const MAX_ISSUE_IMAGE_BYTES = 4 * 1024 * 1024;

/** ファイル選択で受ける種類 */
export const IMAGE_ACCEPT = "image/png,image/jpeg,image/webp,image/gif";

export const IMAGE_EXTENSIONS: Record<ImageKind, string> = {
  png: "png",
  jpeg: "jpg",
  webp: "webp",
  gif: "gif",
};

export const IMAGE_MESSAGES = {
  tooMany: `画像は${MAX_ISSUE_IMAGES}枚までです`,
  tooLarge: `画像は1枚${MAX_ISSUE_IMAGE_BYTES / 1024 / 1024}MBまでです`,
  badType: "画像は PNG・JPEG・WebP・GIF だけです",
} as const;

/** 種類を確かめるのに読む先頭のバイト数 */
export const IMAGE_HEAD_BYTES = 12;

function startsWith(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

/** 中身の先頭バイトから画像の種類を決める（拡張子・申告された種類は信じない）。4種類のどれでもなければ null */
export function detectImageKind(bytes: Uint8Array): ImageKind | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "jpeg";
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38]) && (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61) {
    return "gif";
  }
  // RIFF....WEBP
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return "webp";
  return null;
}

export type ImageCandidate = { size: number; head: Uint8Array };

/**
 * 足そうとする画像を順に確かめる。足せるものの番号と、足せなかった理由（初めに出会った1つ）を返す。
 * 種類 → 大きさ → 枚数の順に見て、超えた画像は足さない
 */
export function pickAddableImages(
  currentCount: number,
  candidates: ImageCandidate[],
): { accepted: number[]; message: string | null } {
  const accepted: number[] = [];
  let message: string | null = null;
  candidates.forEach((candidate, index) => {
    if (detectImageKind(candidate.head) === null) {
      message ??= IMAGE_MESSAGES.badType;
    } else if (candidate.size > MAX_ISSUE_IMAGE_BYTES) {
      message ??= IMAGE_MESSAGES.tooLarge;
    } else if (currentCount + accepted.length >= MAX_ISSUE_IMAGES) {
      message ??= IMAGE_MESSAGES.tooMany;
    } else {
      accepted.push(index);
    }
  });
  return { accepted, message };
}

/** base64 を取り出す（正しくなければ null）。改行・空白・`data:` の頭は受け付けない */
export function decodeBase64(data: string): Uint8Array | null {
  if (data === "" || data.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) return null;
  try {
    const binary = atob(data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

/** 大きすぎる base64 は、取り出す前に断る（取り出したあとの大きさの上限より少し余裕を持たせた長さ） */
export const MAX_IMAGE_BASE64_LENGTH = Math.ceil((MAX_ISSUE_IMAGE_BYTES * 4) / 3) + 4;

/** サーバーに送る画像（中身は base64） */
export type ImageUpload = { data: string };

export type ParsedImage = { bytes: Uint8Array; kind: ImageKind };

/** 送られてきた画像を確かめ直す（Server Action は誰でも直接呼べるため）。正しくなければ null */
export function parseImageUploads(value: unknown): ParsedImage[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_ISSUE_IMAGES) return null;
  const images: ParsedImage[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) return null;
    const { data } = item as Record<string, unknown>;
    if (typeof data !== "string" || data.length > MAX_IMAGE_BASE64_LENGTH) return null;
    const bytes = decodeBase64(data);
    if (!bytes || bytes.length > MAX_ISSUE_IMAGE_BYTES) return null;
    const kind = detectImageKind(bytes);
    if (!kind) return null;
    images.push({ bytes, kind });
  }
  return images;
}

/** `images/<西暦年月>/<ランダムな名前>.<拡張子>`（元のファイル名は使わない） */
export function imagePath(kind: ImageKind, now: Date, id: string): string {
  const month = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  return `images/${month}/${id}.${IMAGE_EXTENSIONS[kind]}`;
}

/** Issueの本文から画像を指すURL（非公開でも、リポジトリを見られる人はログインしていれば見える） */
export function imageUrl(owner: string, repo: string, path: string): string {
  return `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/raw/${IMAGES_BRANCH}/${path}`;
}

/** 画像を入れる専用ブランチ */
export const IMAGES_BRANCH = "issue-images";
