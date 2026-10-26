/**
 * READMEに載せる画像とGIFを、デモの画面（/demo）から撮り直す。
 * 使い方：`npm run readme:shots`（ビルドして本番と同じ形で起動し、撮り終わったら止める）
 * 出力：assets/readme/（PNG と demo.gif）
 *
 * GIFは外部のコマンド（ffmpegなど）を使わず、Chromiumで画像をピクセルに戻して、このファイルの中で組み立てる。
 * 動かない所の差分だけを書くので、小さく収まる（5MB以下）
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, type Browser, type Page } from "@playwright/test";

const PORT = 3101;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const OUT_DIR = path.resolve("assets/readme");
const MAX_GIF_BYTES = 5 * 1024 * 1024;

/** 見た目のテストと同じ「今」。サンプルの時刻が毎回同じになる */
const DEMO_NOW = "2026-10-26T03:00:00Z";

const GIF_VIEWPORT = { width: 1280, height: 720 };
const GIF_WIDTH = 800;
/** 何ミリ秒ごとに画面を撮るか */
const FRAME_INTERVAL_MS = 400;
/** 再生は4秒×9段階＝36秒。GIFでは目標の長さに縮める（20〜30秒） */
const GIF_TARGET_MS = 28_000;
/** 再生が終わったあと、最後の画面を止めて見せる長さ */
const GIF_TAIL_MS = 2_000;

type Frame = { rgba: Uint8ClampedArray; at: number };

async function waitForServer(url: string, child: ChildProcess): Promise<void> {
  const limit = Date.now() + 300_000;
  while (Date.now() < limit) {
    if (child.exitCode !== null) throw new Error("サーバーが起動する前に終了しました");
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // まだ起動中
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("サーバーが起動しませんでした");
}

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", env: process.env });
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} ${args.join(" ")} が失敗しました`)),
    );
  });
}

/** 画面の高さをページ全体に広げ、フォントの読み込みを待つ（tests/visual/demo.spec.ts と同じ考え方） */
async function settle(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
  const width = page.viewportSize()?.width ?? 1440;
  let height = 0;
  let stable = 0;
  for (let i = 0; i < 20 && stable < 3; i++) {
    await page.evaluate(() => window.scrollTo(0, 0));
    const next = await page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return document.documentElement.scrollHeight;
    });
    if (next === height) {
      stable += 1;
    } else {
      stable = 0;
      height = next;
      await page.setViewportSize({ width, height });
    }
    await page.waitForTimeout(100);
  }
}

async function shoot(
  browser: Browser,
  name: string,
  url: string,
  viewport: { width: number; height: number },
  mobile: boolean,
): Promise<void> {
  const context = await browser.newContext({
    viewport,
    colorScheme: "dark",
    locale: "ja-JP",
    timezoneId: "Asia/Tokyo",
    reducedMotion: "reduce",
    deviceScaleFactor: 1,
    hasTouch: mobile,
    isMobile: mobile,
  });
  const page = await context.newPage();
  await page.goto(`${BASE_URL}${url}`);
  await settle(page);
  await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`) });
  await context.close();
  console.log(`撮りました：${name}.png`);
}

// ---- GIF -------------------------------------------------------------------

/** Chromiumの中で PNG を縮小してピクセルに戻す（PNGを読む部品を足さないため） */
async function decodeFrames(
  browser: Browser,
  shots: { png: Buffer; at: number }[],
  width: number,
  height: number,
): Promise<Frame[]> {
  const page = await browser.newPage();
  const frames: Frame[] = [];
  for (const shot of shots) {
    const data = await page.evaluate(
      async ({ base64, w, h }) => {
        const img = new Image();
        img.src = `data:image/png;base64,${base64}`;
        await img.decode();
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("canvas が使えません");
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, 0, 0, w, h);
        return Array.from(ctx.getImageData(0, 0, w, h).data);
      },
      { base64: shot.png.toString("base64"), w: width, h: height },
    );
    frames.push({ rgba: Uint8ClampedArray.from(data), at: shot.at });
  }
  await page.close();
  return frames;
}

/** 色を5ビットずつに丸めて数え、よく出る255色をパレットにする（1色は「変わらない所」用の透明） */
function buildPalette(frames: Frame[]): { palette: Uint8Array; lookup: (r: number, g: number, b: number) => number } {
  const counts = new Map<number, number>();
  for (const frame of frames) {
    const px = frame.rgba;
    for (let i = 0; i < px.length; i += 4) {
      const key = ((px[i] >> 3) << 10) | ((px[i + 1] >> 3) << 5) | (px[i + 2] >> 3);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 255);
  const palette = new Uint8Array(256 * 3);
  const colors: [number, number, number][] = [];
  top.forEach(([key], index) => {
    const r = ((key >> 10) & 31) << 3 | 4;
    const g = ((key >> 5) & 31) << 3 | 4;
    const b = (key & 31) << 3 | 4;
    colors.push([r, g, b]);
    palette.set([r, g, b], index * 3);
  });
  const cache = new Map<number, number>();
  const lookup = (r: number, g: number, b: number): number => {
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    let best = 0;
    let bestDist = Infinity;
    colors.forEach(([cr, cg, cb], index) => {
      const dist = (cr - r) ** 2 + (cg - g) ** 2 + (cb - b) ** 2;
      if (dist < bestDist) {
        bestDist = dist;
        best = index;
      }
    });
    cache.set(key, best);
    return best;
  };
  return { palette, lookup };
}

/** GIFのLZW圧縮（最小コード長8） */
function lzwEncode(indices: Uint8Array): Uint8Array {
  const minCodeSize = 8;
  const clear = 1 << minCodeSize;
  const end = clear + 1;
  const out: number[] = [];
  let bitBuffer = 0;
  let bitCount = 0;
  let codeSize = minCodeSize + 1;
  const write = (code: number) => {
    bitBuffer |= code << bitCount;
    bitCount += codeSize;
    while (bitCount >= 8) {
      out.push(bitBuffer & 255);
      bitBuffer >>>= 8;
      bitCount -= 8;
    }
  };
  let dict = new Map<number, number>();
  let next = end + 1;
  write(clear);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const byte = indices[i];
    const key = (prefix << 8) | byte;
    const found = dict.get(key);
    if (found !== undefined) {
      prefix = found;
      continue;
    }
    write(prefix);
    if (next < 4096) {
      dict.set(key, next++);
      if (next > 1 << codeSize && codeSize < 12) codeSize += 1;
    } else {
      write(clear);
      dict = new Map();
      next = end + 1;
      codeSize = minCodeSize + 1;
    }
    prefix = byte;
  }
  write(prefix);
  write(end);
  if (bitCount > 0) out.push(bitBuffer & 255);
  return Uint8Array.from(out);
}

function encodeGif(frames: Frame[], width: number, height: number, delaysMs: number[]): Buffer {
  const { palette, lookup } = buildPalette(frames);
  const transparent = 255;
  const parts: number[][] = [];
  const u16 = (n: number) => [n & 255, (n >> 8) & 255];
  // ヘッダーと画面の大きさ。パレットは全体で1つ（255番は透明に使う）
  parts.push([...Buffer.from("GIF89a"), ...u16(width), ...u16(height), 0xf7, 0, 0]);
  parts.push([...palette]);
  parts.push([0x21, 0xff, 0x0b, ...Buffer.from("NETSCAPE2.0"), 3, 1, 0, 0, 0]); // 繰り返し

  let previous: Uint8Array | null = null;
  frames.forEach((frame, index) => {
    const current = new Uint8Array(width * height);
    for (let p = 0; p < current.length; p++) {
      current[p] = lookup(frame.rgba[p * 4], frame.rgba[p * 4 + 1], frame.rgba[p * 4 + 2]);
      if (current[p] === transparent) current[p] = transparent - 1;
    }
    // 前の絵と変わった範囲だけを書く
    let x0 = 0;
    let y0 = 0;
    let x1 = width - 1;
    let y1 = height - 1;
    if (previous) {
      x0 = width;
      y0 = height;
      x1 = -1;
      y1 = -1;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (current[y * width + x] !== previous[y * width + x]) {
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            if (y > y1) y1 = y;
          }
        }
      }
      if (x1 < 0) {
        // 変わらない：1ピクセルだけ書いて、時間だけ延ばす
        x0 = x1 = 0;
        y0 = y1 = 0;
      }
    }
    const w = x1 - x0 + 1;
    const h = y1 - y0 + 1;
    const body = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y0 + y) * width + (x0 + x);
        body[y * w + x] = previous && previous[i] === current[i] ? transparent : current[i];
      }
    }
    const delay = Math.max(2, Math.round(delaysMs[index] / 10));
    parts.push([0x21, 0xf9, 4, previous ? 0x05 : 0x04, ...u16(delay), transparent, 0]);
    parts.push([0x2c, ...u16(x0), ...u16(y0), ...u16(w), ...u16(h), 0, 8]);
    const lzw = lzwEncode(body);
    for (let i = 0; i < lzw.length; i += 255) {
      const chunk = lzw.subarray(i, i + 255);
      parts.push([chunk.length, ...chunk]);
    }
    parts.push([0]);
    previous = current;
  });
  parts.push([0x3b]);
  return Buffer.concat(parts.map((part) => Buffer.from(part)));
}

async function recordGif(browser: Browser): Promise<void> {
  const context = await browser.newContext({
    viewport: GIF_VIEWPORT,
    colorScheme: "dark",
    locale: "ja-JP",
    timezoneId: "Asia/Tokyo",
    reducedMotion: "reduce",
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  await page.goto(`${BASE_URL}/demo`);
  await settle(page);
  await page.setViewportSize(GIF_VIEWPORT);
  await page.evaluate(() => document.fonts.ready);

  const shots: { png: Buffer; at: number }[] = [];
  const startedAt = Date.now();
  shots.push({ png: await page.screenshot(), at: 0 });
  await page.getByRole("button", { name: /再生/ }).click();
  const playStartedAt = Date.now();
  // 帯のボタンが「もう一度」になったら再生が終わり
  while (true) {
    const label = await page.getByRole("button", { name: /再生中|もう一度/ }).first().innerText();
    shots.push({ png: await page.screenshot(), at: Date.now() - startedAt });
    if (label.includes("もう一度")) break;
    if (Date.now() - playStartedAt > 60_000) throw new Error("再生が終わりませんでした");
    await page.waitForTimeout(FRAME_INTERVAL_MS);
  }
  await context.close();

  const height = Math.round((GIF_VIEWPORT.height * GIF_WIDTH) / GIF_VIEWPORT.width);
  const frames = await decodeFrames(browser, shots, GIF_WIDTH, height);

  // 撮った時刻の間隔を、目標の長さに合わせて縮める。最後の画面は少し止める
  const realMs = frames[frames.length - 1].at - frames[0].at;
  const scale = Math.min(1, GIF_TARGET_MS / Math.max(realMs, 1));
  const delays = frames.map((frame, i) =>
    i < frames.length - 1 ? (frames[i + 1].at - frame.at) * scale : GIF_TAIL_MS,
  );
  const gif = encodeGif(frames, GIF_WIDTH, height, delays);
  if (gif.length > MAX_GIF_BYTES) {
    throw new Error(`GIFが大きすぎます：${(gif.length / 1024 / 1024).toFixed(1)}MB（上限5MB）`);
  }
  await writeFile(path.join(OUT_DIR, "demo.gif"), gif);
  const seconds = delays.reduce((sum, d) => sum + d, 0) / 1000;
  console.log(`撮りました：demo.gif（${(gif.length / 1024).toFixed(0)}KB、${seconds.toFixed(0)}秒）`);
}

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });
  await run("npm", ["run", "build"]);
  const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(PORT)], {
    stdio: "inherit",
    env: { ...process.env, DEMO_NOW },
  });
  try {
    await waitForServer(`${BASE_URL}/demo`, server);
    const browser = await chromium.launch();
    try {
      const pc = { width: 1440, height: 900 };
      await shoot(browser, "home", "/demo", pc, false);
      await shoot(browser, "repo", "/demo/repos/demo/todo-app", pc, false);
      await shoot(browser, "settings", "/demo/settings", pc, false);
      await shoot(browser, "home-mobile", "/demo", { width: 390, height: 844 }, true);
      await recordGif(browser);
    } finally {
      await browser.close();
    }
  } finally {
    server.kill();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
