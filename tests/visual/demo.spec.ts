import { expect, test, type Page } from "@playwright/test";

const REPO_PAGE = "/demo/repos/demo/todo-app";

/**
 * フォントの読み込みを待ち、画面の高さをページ全体に広げてから撮る。
 * fullPage のままだと、上に貼り付く帯（`position: sticky`）が、スクロール位置や最初の画面の高さの所に写って、ずれて見えるため。
 * 「あなたの番」の場所は最初の1画面の高さ（100svh）なので、画面を伸ばす前に、その高さを今の画面の高さで止めておく
 * （止めないと、画面を伸ばすたびにその場所も伸びて、高さが決まらない）
 */
async function settle(page: Page) {
  await page.evaluate(() => {
    const style = document.createElement("style");
    style.textContent = `main > section[data-skip-target]:not([data-empty]) { min-height: ${window.innerHeight - 52}px !important; }`;
    document.head.appendChild(style);
    // 上や左右に貼り付く部品（`position: sticky`）は、ページの下端までスクロールしたあとだと、
    // 上へ戻しても中の文字が1画素未満ずれて描かれる（ボタンを押すとその場所までスクロールするので、押すまでの速さで画像が変わる）。
    // 画面をページ全体に広げると貼り付く意味は無いので、撮るときは普通の位置に置き、スクロールの跡が残らないようにする
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
      if (getComputedStyle(el).position === "sticky") el.style.setProperty("position", "static", "important");
    }
  });
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

/** 「あなたの番」の、見えている大きい1件（片づけて隠した1件は除く。マージ待ちの一覧の行は article ではないので当たらない） */
const CURRENT = "main section[data-skip-target] article:not([data-leaving])";

/** マージ待ちの一覧（マージ待ちが2件以上で、大きい1件の代わりに出る）と、その行 */
const queueList = (page: Page) => page.getByRole("list", { name: /^マージ待ち \d+件（この順に押す）$/ });
const queueRows = (page: Page) => queueList(page).getByRole("listitem");
/** 一覧の見出しに書いてある件数 */
const queueCount = async (page: Page) =>
  Number((await page.getByRole("heading", { name: /^マージ待ち \d+件/ }).textContent())?.match(/\d+/)?.[0] ?? "0");
/** 「ほかに N件」の N */
const restCount = async (page: Page) => Number((await page.getByText(/^ほかに/).textContent())?.match(/\d+/)?.[0] ?? "0");

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

  test("マージの確認（その場で「マージする／やめる」に変わる）", async ({ page }) => {
    await page.goto(REPO_PAGE);
    // 先頭の1件（止まった）を片づけると、マージ待ちの番になる。マージ待ちは2件以上あるので、大きい1件の代わりに一覧が出る
    await page.locator(CURRENT).getByRole("button", { name: "再開" }).click();
    await expect(page.locator(CURRENT)).toHaveCount(0);
    const first = queueRows(page).first();
    // 確認は押した行だけが開く（1番の行の「マージ…」は1つだけ）
    await first.getByRole("button", { name: "マージ…" }).click();
    await expect(first.getByRole("button", { name: "マージする" })).toBeFocused();
    await expect(first.getByRole("button", { name: "やめる" })).toBeVisible();
    await expect(first.getByRole("list", { name: "マージの前の確認" }).getByRole("listitem")).toHaveCount(3);
    await expect(queueList(page).getByRole("button", { name: "マージする" })).toHaveCount(1);
    await settle(page);
    await expect(page).toHaveScreenshot("repo-merge.png");
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

  test("あなたの番は常に1件だけ。最初の1画面に収まり、片づけると次の1件に替わって「ほかに N件」が減る", async ({ page }) => {
    await page.goto("/demo");
    await page.evaluate(() => document.fonts.ready);
    const current = page.locator(CURRENT);
    await expect(current).toHaveCount(1);
    // 1件の題名とボタンが、最初の1画面（上端の帯の下）に収まる
    const viewport = page.viewportSize();
    const box = await current.boundingBox();
    expect(box).not.toBeNull();
    if (!box || !viewport) return;
    expect(box.y).toBeGreaterThanOrEqual(52);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);

    const rest = async () => Number((await page.getByText(/^ほかに/).textContent())?.match(/\d+/)?.[0] ?? "0");
    const before = await rest();
    const firstKey = await current.getAttribute("data-key");
    // キーボードだけで押す：フォーカスしてから Enter
    await current.getByRole("button", { name: "再開" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(CURRENT)).toHaveCount(1);
    await expect.poll(async () => page.locator(CURRENT).getAttribute("data-key")).not.toBe(firstKey);
    expect(await rest()).toBe(before - 1);
    // フォーカスは次の1件の最初の操作へ移っている
    const focusedInCurrent = await page.evaluate(
      (sel) => document.querySelector(sel)?.contains(document.activeElement) ?? false,
      CURRENT,
    );
    expect(focusedInCurrent).toBe(true);
  });

  test("マージ待ちの一覧：すすめる順に番号が付き、1番だけ主役のボタン。どの行でもマージでき、片づけると行が消えて番号が繰り上がる", async ({ page }) => {
    await page.goto(REPO_PAGE);
    await page.evaluate(() => document.fonts.ready);
    // 強い色の物（止まった）が先にある間は、マージ待ちが何件あっても一覧は出ない（大きい1件のまま）
    await expect(page.locator(CURRENT)).toHaveCount(1);
    await expect(queueList(page)).toHaveCount(0);
    const before = await restCount(page);
    await page.locator(CURRENT).getByRole("button", { name: "再開" }).click();
    // マージ待ちの番になると、大きい1件は出ず（0件）、代わりに一覧が1つだけ出る
    await expect(queueList(page)).toHaveCount(1);
    await expect(page.locator(CURRENT)).toHaveCount(0);
    const rows = queueRows(page);
    const count = await queueCount(page);
    expect(count).toBeGreaterThanOrEqual(3);
    await expect(rows).toHaveCount(count);
    // 「ほかに N件」は、マージ待ち以外の残りだけを数える（片づけた1件と、一覧に出たマージ待ちは数えない）
    expect(await restCount(page)).toBe(before - count);
    const numbers = () => rows.evaluateAll((els) => els.map((el) => el.firstElementChild?.textContent ?? ""));
    const keys = () => rows.evaluateAll((els) => els.map((el) => el.getAttribute("data-key") ?? ""));
    expect(await numbers()).toEqual(Array.from({ length: count }, (_, i) => String(i + 1)));
    // 順番待ちを止めている物（#21）が1番で、マージすると動き出す物が行に出る。その次が、触るファイルの重なる物（#22）
    const order = await keys();
    expect(order.slice(0, 2)).toEqual(["demo/todo-app#21", "demo/todo-app#22"]);
    await expect(rows.first()).toContainText(/マージすると #\d+.*が動き出します/);
    await expect(rows.nth(1)).not.toContainText("動き出します");
    // 1番の行だけ主役のボタン（地が付く）。2番目以降は地なしの文字のボタンで、どれも押せる
    const merge = rows.getByRole("button", { name: "マージ…" });
    await expect(merge).toHaveCount(count);
    const bg = await merge.evaluateAll((els) => els.map((el) => getComputedStyle(el).backgroundColor));
    const clear = "rgba(0, 0, 0, 0)";
    expect(bg[0]).not.toBe(clear);
    expect(bg.slice(1)).toEqual(Array.from({ length: count - 1 }, () => clear));
    // ボタンはスマホでも押しやすい高さ（44px以上）。行は横にはみ出さない
    const viewport = page.viewportSize();
    for (const row of await rows.all()) {
      const box = await row.boundingBox();
      const button = await row.getByRole("button", { name: "マージ…" }).boundingBox();
      expect(box).not.toBeNull();
      expect(button).not.toBeNull();
      if (!box || !button || !viewport) return;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
      if (viewport.width <= 899) expect(button.height).toBeGreaterThanOrEqual(44);
    }

    // 2番の行から押す（順番はすすめるだけ）：確認はその行だけに開き、やめると閉じてフォーカスが戻る
    const second = rows.nth(1);
    await second.getByRole("button", { name: "マージ…" }).click();
    await expect(rows.getByRole("button", { name: "マージする" })).toHaveCount(1);
    await second.getByRole("button", { name: "やめる" }).click();
    await expect(second.getByRole("button", { name: "マージ…" })).toBeFocused();
    // マージすると、その行が消え、残りの行の番号が繰り上がる（順番は変わらない）
    await second.getByRole("button", { name: "マージ…" }).click();
    await second.getByRole("button", { name: "マージする" }).click();
    await expect(rows).toHaveCount(count - 1);
    expect(await keys()).toEqual(order.filter((_, i) => i !== 1));
    expect(await numbers()).toEqual(Array.from({ length: count - 1 }, (_, i) => String(i + 1)));
    expect(await queueCount(page)).toBe(count - 1);
    // フォーカスは次の行（繰り上がって2番になった行）の「マージ…」へ移っている
    await expect(rows.nth(1).getByRole("button", { name: "マージ…" })).toBeFocused();
  });

  test("札を押した瞬間に、押した札が「今いる」の見た目になり、前にいた札は戻る（次の画面が遅くても）", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "mobile", "札はPCの帯・左のバーで確かめる");
    await page.goto("/demo");
    await page.evaluate(() => document.fonts.ready);
    const nav = page.getByRole("navigation", { name: "リポジトリ" }).first();
    const home = nav.getByRole("link", { name: /^全部/ });
    const target = nav.getByRole("link", { name: /^すべてのリポジトリ/ });
    const bg = (l: typeof home) => l.evaluate((el) => getComputedStyle(el).backgroundColor);
    const currentBg = await bg(home);
    const idleBg = await bg(target);
    expect(currentBg).not.toBe(idleBg);

    // 次の画面のデータ（RSC）の返事を止めて、遅いページへの移動を作る
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(/[?&]_rsc=/, async (route) => {
      await gate;
      await route.continue();
    });

    await target.click();
    // 返事を待たずに、押した札が「今いる」の見た目に、前にいた札が戻る
    await expect(target.locator("[data-pending]")).toHaveCount(1);
    expect(await bg(target)).toBe(currentBg);
    expect(await bg(home)).toBe(idleBg);
    // 上の帯・左のバーは消えない
    await expect(page.locator("header")).toBeVisible();
    await expect(nav).toBeVisible();

    release();
    await expect(page).toHaveURL(/\/demo\/repos$/);
    await expect(target).toHaveAttribute("aria-current", "page");
  });

  test("横にはみ出さない", async ({ page }) => {
    for (const path of ["/demo", REPO_PAGE]) {
      await page.goto(path);
      await page.evaluate(() => document.fonts.ready);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, path).toBeLessThanOrEqual(0);
    }
  });
});
