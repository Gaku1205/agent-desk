import { expect, test, type Page } from "@playwright/test";

const REPO_PAGE = "/demo/repos/demo/todo-app";

/** フォントの読み込みを待ってから撮る */
async function settle(page: Page) {
  await page.evaluate(() => document.fonts.ready);
}

test.describe("デモの画面", () => {
  test("ホーム", async ({ page }) => {
    await page.goto("/demo");
    await settle(page);
    await expect(page).toHaveScreenshot("home.png", { fullPage: true });
  });

  test("リポジトリのページ", async ({ page }) => {
    await page.goto(REPO_PAGE);
    await settle(page);
    await expect(page).toHaveScreenshot("repo.png", { fullPage: true });
  });

  test("リポジトリのページ（公開済みを出した状態）", async ({ page }) => {
    await page.goto(REPO_PAGE);
    await page.getByRole("button", { name: /公開済みを表示/ }).click();
    await settle(page);
    await expect(page).toHaveScreenshot("repo-deployed.png", { fullPage: true });
  });

  test("設定", async ({ page }) => {
    await page.goto("/demo/settings");
    await settle(page);
    await expect(page).toHaveScreenshot("settings.png", { fullPage: true });
  });

  test("メニューを開いた状態（スマホ）", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "メニューボタンはスマホだけ");
    await page.goto("/demo");
    await page.getByRole("button", { name: "メニュー" }).click();
    await settle(page);
    await expect(page).toHaveScreenshot("menu-open.png");
  });
});
