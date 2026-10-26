import { expect, test, type Page } from "@playwright/test";

const REPO_PAGE = "/demo/repos/demo/todo-app";

/**
 * フォントの読み込みを待ち、画面の高さをページ全体に広げてから撮る。
 * fullPage のままだと、上に貼り付く帯やサイドバー（`position: sticky`・`100vh`）が
 * スクロール位置や最初の画面の高さの所に写って、ずれて見えるため
 */
async function settle(page: Page) {
  // フォントは使う文字ごとに分けて読み込まれる。読み込みが終わる前に高さを測ると、
  // 代わりのフォントの高さで決まってしまい、環境によって画像の大きさがずれる
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
    const dump = await page.evaluate(() =>
      Array.from(document.querySelectorAll("body *"))
        .map((el) => {
          const r = el.getBoundingClientRect();
          return `DUMP ${el.tagName.toLowerCase()}.${String((el as HTMLElement).className).slice(0, 40)} t=${Math.round(r.top)} h=${Math.round(r.height)} w=${Math.round(r.width)} f=${getComputedStyle(el).fontFamily.slice(0, 20)}`;
        })
        .join("\n"),
    );
    console.log(dump);
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
