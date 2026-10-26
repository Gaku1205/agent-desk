import { defineConfig } from "@playwright/test";

const PORT = 3100;

/** 見た目のテスト用。デモの画面（ログイン不要）のスクショを、基準の画像と比べる */
export default defineConfig({
  testDir: "./tests/visual",
  snapshotPathTemplate: "{testDir}/__screenshots__/{projectName}/{arg}{ext}",
  outputDir: "./test-results",
  reporter: "list",
  expect: {
    toHaveScreenshot: { maxDiffPixelRatio: 0.01 },
  },
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    colorScheme: "dark",
    locale: "ja-JP",
    timezoneId: "Asia/Tokyo",
    reducedMotion: "reduce",
    // 文字の幅が環境のヒンティング設定で変わらないようにする（変わると折り返しが変わり、画像の高さがずれる）
    launchOptions: { args: ["--font-render-hinting=none"] },
  },
  projects: [
    { name: "pc", use: { viewport: { width: 1440, height: 900 } } },
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
