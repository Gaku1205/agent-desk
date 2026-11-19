import { expect, test } from "@playwright/test";

// ハイドレーション前（JS のファイルが届く前）に押したタップを覚え、JS が動いたら1回だけ流し直す（Issue #615）。
// 基準の画像は使わない
test.skip(({ isMobile }) => !isMobile, "スマホの大きさでだけ動かす");

test("ハイドレーション前に押したスイッチが、JS が動いたあとに1回だけ反映される", async ({ page }) => {
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  // JS のファイルを止めておく（ハイドレーション前を真似る）。あとで通す
  await page.route("**/_next/static/chunks/**", async (route) => {
    await held;
    await route.continue();
  });
  await page.goto("/demo/settings", { waitUntil: "commit" });
  const autoAdd = page.getByRole("switch", { name: "Auto-add" });
  await autoAdd.waitFor();
  const before = await autoAdd.getAttribute("aria-checked");
  await autoAdd.tap();
  // JS が動くまでは何も変わらない
  await expect(autoAdd).toHaveAttribute("aria-checked", before ?? "false");
  release();
  const after = before === "true" ? "false" : "true";
  // 動き出したあと、押した分が1回だけ反映される（2回だと元に戻る）
  await expect(autoAdd).toHaveAttribute("aria-checked", after, { timeout: 10_000 });
  await page.waitForTimeout(500);
  await expect(autoAdd).toHaveAttribute("aria-checked", after);
});

test("Dashboard の期間は URL のリンクで、JS が無くても切り替わる", async ({ page }) => {
  await page.route("**/_next/static/chunks/**", (route) => route.abort());
  await page.goto("/demo/dashboard", { waitUntil: "commit" });
  const tab = page.getByRole("tab", { name: "7d" });
  await tab.waitFor();
  await expect(tab).toHaveAttribute("href", /\?period=7d$/);
  await tab.tap();
  await expect(page).toHaveURL(/\/demo\/dashboard\?period=7d$/);
  await expect(page.getByRole("tab", { name: "7d" })).toHaveAttribute("aria-selected", "true");
});
