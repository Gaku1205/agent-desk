import { defineConfig } from "@playwright/test";

const PORT = 3100;

/** 見た目のテスト用。デモの画面（ログイン不要）のスクショを、基準の画像と比べる */
export default defineConfig({
  testDir: "./tests/visual",
  snapshotPathTemplate: "{testDir}/__screenshots__/{projectName}/{arg}{ext}",
  outputDir: "./test-results",
  reporter: "list",
  expect: {
    // 画面の1%（約1万画素）まで違っても通すと、名札の文字を足すような小さい変更が通るので、数百画素以下にする
    toHaveScreenshot: { maxDiffPixels: 100 },
  },
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    colorScheme: "dark",
    locale: "ja-JP",
    timezoneId: "Asia/Tokyo",
    reducedMotion: "reduce",
  },
  projects: [
    { name: "pc", use: { viewport: { width: 1440, height: 900 } } },
    // PCの中間の幅と広い幅（幅を変えても「あなたの番」の行が崩れないか）
    { name: "pc-1024", use: { viewport: { width: 1024, height: 768 } } },
    { name: "pc-1920", use: { viewport: { width: 1920, height: 1080 } } },
    {
      name: "mobile",
      use: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true },
    },
  ],
  webServer: {
    command: `npm run build && npm run start -- --hostname 127.0.0.1 --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}/demo`,
    env: { DEMO_NOW: "2026-10-26T03:00:00Z" },
    reuseExistingServer: false,
    timeout: 300_000,
  },
});
