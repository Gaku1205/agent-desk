import { expect, test, type Page } from "@playwright/test";

// スマホのメニュー（ハンバーガー）が、読み込み中・取り直しの後・ページを移った後でも開閉でき、
// 閉じたあとに inert がどこにも残らないことを確かめる。基準の画像は使わない（Issue #556）
test.skip(({ isMobile }) => !isMobile, "スマホの大きさでだけ動かす");

const PAGE = "/demo/repos/demo/todo-app";

const menuButton = (page: Page) => page.getByRole("button", { name: "メニュー", exact: true });
const inertCount = (page: Page) => page.evaluate(() => document.querySelectorAll("[inert][data-menu-inert]").length);
const markCount = (page: Page) => page.evaluate(() => document.querySelectorAll("[data-menu-inert]").length);

async function openAndClose(page: Page) {
  const button = menuButton(page);
  await button.tap();
  await expect(button).toHaveAttribute("aria-expanded", "true");
  expect(await inertCount(page)).toBeGreaterThan(0);
  // 開いている間はシートがボタンの上に重なる（設計どおり）ので、Esc で閉じる
  await page.keyboard.press("Escape");
  await expect(button).toHaveAttribute("aria-expanded", "false");
  expect(await markCount(page)).toBe(0);
  await expect(page.locator("header[inert], main[inert]")).toHaveCount(0);
}

// ボタンが出てから押す。ハイドレーション前のタップは確かめていない（別Issueで扱う）
test("読み込みの直後でも、メニューが開いて閉じる", async ({ page }) => {
  await page.goto(PAGE, { waitUntil: "commit" });
  await menuButton(page).waitFor();
  await openAndClose(page);
});

test("読み込みの最中に開いたままでも、閉じたら inert が残らない", async ({ page }) => {
  await page.goto(PAGE);
  await menuButton(page).tap();
  // 開いている間に、メニューと同じ階層へ要素が増える（流れてきた続き・入れ替え）
  await page.evaluate(() => {
    const sheet = document.getElementById("menu-sheet");
    const extra = document.createElement("div");
    extra.id = "late";
    sheet?.parentElement?.appendChild(extra);
  });
  await expect(page.locator("#late")).toHaveAttribute("inert", "");
  await page.keyboard.press("Escape");
  await expect(menuButton(page)).toHaveAttribute("aria-expanded", "false");
  expect(await markCount(page)).toBe(0);
  await expect(page.locator("#late")).not.toHaveAttribute("inert", "");
});

test("取り直しの後でも開閉できる", async ({ page }) => {
  await page.goto(PAGE);
  await page.getByRole("button", { name: /^更新/ }).tap();
  await page.waitForLoadState("networkidle");
  await openAndClose(page);
});

test("ページを移った後でも開閉でき、inert が残らない", async ({ page }) => {
  await page.goto(PAGE);
  await menuButton(page).tap();
  await page.getByRole("dialog", { name: "メニュー" }).getByRole("link", { name: "Dashboard" }).tap();
  await expect(page).toHaveURL(/\/demo\/dashboard/);
  await expect(menuButton(page)).toHaveAttribute("aria-expanded", "false");
  expect(await markCount(page)).toBe(0);
  await openAndClose(page);
});
