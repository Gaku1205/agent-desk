import { expect, test, type Page } from "@playwright/test";

const REPO_PAGE = "/demo/repos/demo/todo-app";

/**
 * フォントの読み込みを待ち、画面の高さをページ全体に広げてから撮る。
 * fullPage のままだと、上に貼り付く帯やサイドバー（`position: sticky`・`100vh`）が
 * スクロール位置や最初の画面の高さの所に写って、ずれて見えるため
 */
async function settle(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => window.scrollTo(0, 0));
  const width = page.viewportSize()?.width ?? 1440;
  let height = 0;
  for (let i = 0; i < 3; i++) {
    const next = await page.evaluate(() => document.documentElement.scrollHeight);
    if (next === height) break;
    height = next;
    await page.setViewportSize({ width, height });
  }
  await page.evaluate(() => window.scrollTo(0, 0));
}

test.describe("デモの画面", () => {
  test("ホーム", async ({ page }) => {
    await page.goto("/demo");
    await settle(page);
    await expect(page).toHaveScreenshot("home.png");
  });

  test("リポジトリのページ", async ({ page }) => {
    await page.goto(REPO_PAGE);
    await settle(page);
    await expect(page).toHaveScreenshot("repo.png");
  });

  test("リポジトリのページ（公開済みを出した状態）", async ({ page }) => {
    await page.goto(REPO_PAGE);
    await page.getByRole("button", { name: /公開済みを表示/ }).click();
    await settle(page);
    await expect(page).toHaveScreenshot("repo-deployed.png");
  });

  test("設定", async ({ page }) => {
    await page.goto("/demo/settings");
    await settle(page);
    await expect(page).toHaveScreenshot("settings.png");
  });

  test("メニューを開いた状態（スマホ）", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "メニューボタンはスマホだけ");
    await page.goto("/demo");
    await page.getByRole("button", { name: "メニュー" }).click();
    await page.evaluate(() => document.fonts.ready);
    await expect(page).toHaveScreenshot("menu-open.png");
  });
});
