import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isBehindChangeMarks, repoChangeKey } from "../changeMarks";
import type { RepoData } from "./types";

// Next.js のキャッシュの代わり：キーごとに覚え、タグを無効にしたら捨てる。全部のインスタンスで共有する（Vercel と同じ）。
// 保存は取り終わってから行うので、取得の途中の無効化は保存で上書きされる（Next.js と同じ）
const store = vi.hoisted(() => ({
  entries: new Map<string, { value: unknown; tags: string[] }>(),
  /** 返事を返し終えてから動かす物（`after`） */
  afterResponse: [] as Array<() => void>,
}));

function invalidate(tag: string) {
  for (const [key, entry] of store.entries) {
    if (entry.tags.includes(tag)) store.entries.delete(key);
  }
}

vi.mock("next/cache", () => ({
  unstable_cache:
    <T>(fn: () => Promise<T>, keyParts: string[], options?: { tags?: string[] }) =>
    async (): Promise<T> => {
      const key = keyParts.join("|");
      const known = store.entries.get(key);
      if (known) return known.value as T;
      const value = await fn();
      store.entries.set(key, { value, tags: options?.tags ?? [] });
      return value;
    },
  revalidateTag: invalidate,
  updateTag: invalidate,
}));

vi.mock("next/server", () => ({
  after: (run: () => void) => {
    store.afterResponse.push(run);
  },
}));

type RepoCacheModule = typeof import("./repoCache");

/** 別のインスタンス（メモリを共有しない、別に読み込んだモジュール） */
async function loadInstance(): Promise<RepoCacheModule> {
  vi.resetModules();
  return import("./repoCache");
}

// ページ（`cachedRepoData`）と `/api/changes`（`getChangeMarks`）は、別々のインスタンスで動く
const page = await loadInstance();
const api = await loadInstance();
const { repoTag, urgentTag } = await import("../webhook");

function data(label: string): RepoData {
  return { mainDeployedAt: label } as unknown as RepoData;
}

const START = new Date("2026-01-01T00:00:00Z").getTime();
let counter = 0;
let repo = { owner: "owner", repo: "repo0" };
let calls = 0;
const load = async () => data(`v${++calls}`);

/** Webhook が来た（タグを無効にする）。急ぎの知らせは、急ぎのタグも無効にする */
function webhook(options: { urgent?: boolean } = {}) {
  invalidate(repoTag(repo));
  if (options.urgent) invalidate(urgentTag(repo));
}

function at(ms: number) {
  vi.setSystemTime(START + ms);
}

/** 画面が `/api/changes` を見る（別のインスタンス） */
async function apiMark(): Promise<string> {
  return (await api.getChangeMarks([repo]))[repoChangeKey(repo)];
}

/** 画面が取り直す（ページのインスタンス）。データの中身の印と、反映済みの印を返す */
async function pageShow(): Promise<{ label: string; applied: string }> {
  const { data: shown, changeMark } = await page.cachedRepoData(repo, load);
  return { label: shown.mainDeployedAt as unknown as string, applied: changeMark };
}

beforeEach(() => {
  store.entries.clear();
  store.afterResponse.length = 0;
  repo = { owner: "owner", repo: `repo${++counter}` };
  calls = 0;
  vi.useFakeTimers({ toFake: ["Date"] });
  at(0);
});
afterEach(() => vi.useRealTimers());

describe("取り直しの持ち分（急ぎでない知らせは60秒の区切りごと、急ぎの知らせは残してある1回分ですぐ）", () => {
  /** 5秒おきに急ぎでない知らせが来続けるとき、取り直した秒 */
  async function busyFetchSeconds(untilSecond: number, mark: (second: number) => Promise<unknown> = apiMark) {
    const fetchedAt: number[] = [];
    for (let second = 5; second <= untilSecond; second += 5) {
      at(second * 1000);
      webhook();
      await mark(second);
      const before = calls;
      await pageShow();
      if (calls > before) fetchedAt.push(second);
    }
    return fetchedAt;
  }

  it("5秒おきに変わり続けても、最初の変化はすぐ、そのあとは60秒の区切りごと（前の 15・45・105… より多くは取り直さない）", async () => {
    await pageShow(); // 0秒：最初の表示
    expect(await busyFetchSeconds(300)).toEqual([5, 60, 120, 180, 240, 300]);
  });

  it("変わり続けている間も、急ぎの知らせは残してある1回分ですぐ取り直す", async () => {
    await pageShow();
    await busyFetchSeconds(100); // 5・60秒に取り直した
    const busyCalls = calls;
    at(103_000);
    webhook({ urgent: true }); // ラベルが付いた（あなたの番になった）
    await apiMark();
    expect((await pageShow()).label).toBe(`v${busyCalls + 1}`);
    expect(calls).toBe(busyCalls + 1);
    // 急ぎの分を使ったあと、急ぎでない知らせは次の区切りでも待つ（2回分たまるまで）
    at(125_000);
    webhook();
    await apiMark();
    await pageShow();
    expect(calls).toBe(busyCalls + 1);
    at(180_000);
    await apiMark();
    await pageShow();
    expect(calls).toBe(busyCalls + 2);
  });

  it("急ぎの知らせが毎秒続いても、持ち分を使い切ったら区切りごとに1回まで（1時間で最大62回）", async () => {
    await pageShow(); // 0秒：最初の表示（知らせによる取り直しではない）
    let fetched = 0;
    for (let second = 1; second < 3600; second += 1) {
      at(second * 1000);
      webhook({ urgent: true });
      await apiMark();
      const before = calls;
      await pageShow();
      if (calls > before) fetched += 1;
    }
    // 1秒（静かなあとの最初）・6秒（残してある1回分）と、そのあとの区切りごと（59回）
    expect(fetched).toBe(61);
  });

  it("続けて届いた急ぎの知らせは、前に取ってから5秒あくまでまとめる", async () => {
    await pageShow();
    at(10 * 60_000);
    webhook({ urgent: true }); // ラベルが外れた
    await apiMark();
    expect((await pageShow()).label).toBe("v2");
    at(10 * 60_000 + 1000);
    webhook({ urgent: true }); // 付いた
    await apiMark();
    expect((await pageShow()).label).toBe("v2");
    at(10 * 60_000 + 5000);
    await apiMark();
    expect((await pageShow()).label).toBe("v3");
  });

  it("変わり続けたあと、静かにして持ち分が戻れば、次の変化はまたすぐ。続く急ぎでない知らせは次の区切りで", async () => {
    await pageShow();
    await busyFetchSeconds(110); // 5・60秒に取り直した
    const busyCalls = calls;
    at(230_000);
    webhook();
    await apiMark();
    await pageShow(); // 静かなあとの最初の変化は、すぐ
    expect(calls).toBe(busyCalls + 1);
    at(238_000);
    webhook();
    await apiMark();
    await pageShow(); // 8秒後：急ぎでない知らせは待つ
    expect(calls).toBe(busyCalls + 1);
    at(240_000);
    await apiMark();
    await pageShow(); // 次の区切り：取り直す
    expect(calls).toBe(busyCalls + 2);
  });

  it("持ち分は、別のインスタンスが印を進めても同じに効く", async () => {
    await pageShow();
    const others = [await loadInstance(), await loadInstance(), await loadInstance()];
    const fetchedAt = await busyFetchSeconds(120, (second) => others[(second / 5) % others.length].getChangeMarks([repo]));
    expect(fetchedAt).toEqual([5, 60, 120]);
  });

  it("ページの表示だけでも（`/api/changes` を見ていなくても）、静かなあとの変化は取り直す", async () => {
    await pageShow();
    at(10 * 60_000);
    webhook();
    const shown = await pageShow();
    expect(shown.label).toBe("v2");
    expect(await apiMark()).toBe(shown.applied);
  });

  it("待っている間の最後の変化も、次の区切りの取り直しで出る", async () => {
    await pageShow();
    at(3000);
    webhook();
    await apiMark();
    expect((await pageShow()).label).toBe("v2"); // 最初の変化はすぐ
    at(14_000);
    webhook();
    await apiMark();
    expect((await pageShow()).label).toBe("v2");
    at(59_000);
    webhook(); // 最後の変化
    await apiMark();
    expect((await pageShow()).label).toBe("v2");
    at(60_000);
    await apiMark();
    expect((await pageShow()).label).toBe("v3");
    // まとめて1回だけ。そのあとは変わっていないので取り直さない（しばらくたっても同じ）
    for (const second of [90, 150, 200, 400]) {
      at(second * 1000);
      await apiMark();
      expect((await pageShow()).label).toBe("v3");
    }
    expect(calls).toBe(3);
  });

  it("取り直しを許した変化は、区切りが進んでも持ち分を使い直さない（次の変化がすぐ出る）", async () => {
    await pageShow();
    at(3000);
    webhook();
    await apiMark(); // 1つ前の区切りの分を使う
    await pageShow();
    // 次の区切り・その次の区切りで何度見ても、同じ変化に持ち分は使わない
    for (const second of [61, 65, 125]) {
      at(second * 1000);
      await apiMark();
    }
    at(130_000);
    webhook();
    await apiMark();
    expect((await pageShow()).label).toBe("v3");
    at(131_000);
    webhook({ urgent: true });
    at(136_000);
    await apiMark();
    expect((await pageShow()).label).toBe("v4"); // 急ぎの1回分も残っている
  });

  it("印は、取り直してよい時になって初めて進む", async () => {
    const first = await pageShow();
    expect(await apiMark()).toBe(first.applied);

    at(3000);
    webhook();
    const second = await apiMark(); // 静かなあとの最初の変化は、すぐ進む
    expect(second).not.toBe(first.applied);
    at(10_000);
    webhook();
    expect(await apiMark()).toBe(second); // 待っている間は進まない
    at(30_000);
    webhook();
    expect(await apiMark()).toBe(second);

    at(60_000);
    const markAfter = await apiMark();
    expect(markAfter).not.toBe(second);
    const shown = await pageShow();
    expect(shown.label).toBe("v2");
    expect(shown.applied).toBe(markAfter);
    expect(await apiMark()).toBe(markAfter);
  });

  it("手で押す「同期」・ボタン操作の後は、持ち分に関係なくすぐ取り直す", async () => {
    await pageShow();
    at(1000);
    webhook();
    await apiMark();
    expect((await pageShow()).label).toBe("v2");
    at(2000);
    webhook({ urgent: true });
    at(8000);
    await apiMark();
    expect((await pageShow()).label).toBe("v3"); // 持ち分を2回分とも使った
    at(9000);
    webhook({ urgent: true });
    const markBefore = await apiMark();
    expect((await pageShow()).label).toBe("v3");

    at(10_000);
    page.invalidateRepoNow(repo);
    const shown = await pageShow();
    expect(shown.label).toBe("v4");
    expect(await apiMark()).toBe(shown.applied);
    expect(shown.applied).not.toBe(markBefore);
  });
});

describe("インスタンスと取得の途中をまたいでも、最後の変化が画面に出る", () => {
  it("取得の途中に来た変化も、次の取り直しで画面に出る", async () => {
    // CI の最中：GraphQL の取得中に check_run が来る
    const loadWithWebhook = async () => {
      at(1000);
      webhook();
      return data(`v${++calls}`);
    };
    const first = await page.cachedRepoData(repo, loadWithWebhook);
    expect(first.data.mainDeployedAt).toBe("v1");

    // 画面は「印 > 反映済み」の間は取り直す。印が進み、取り直しで変化が出る
    at(5000);
    const mark = await apiMark();
    expect(isBehindChangeMarks({ [repoChangeKey(repo)]: first.changeMark }, { [repoChangeKey(repo)]: mark })).toBe(
      true,
    );
    const shown = await pageShow();
    expect(shown.label).toBe("v2");
    expect(shown.applied).toBe(mark);
  });

  it("別のインスタンスで印を返しても、最後の変化が画面に出る", async () => {
    const key = repoChangeKey(repo);
    let screen = await pageShow(); // 画面が覚えている反映済みの印
    expect(screen.label).toBe("v1");

    // 3秒：最初の変化はすぐ。10秒：次の変化は、/api/changes が別のインスタンスでも、次の区切りまで印を進めない
    at(3000);
    webhook();
    let mark = await apiMark();
    expect(isBehindChangeMarks({ [key]: screen.applied }, { [key]: mark })).toBe(true);
    screen = await pageShow();
    at(10_000);
    webhook();
    mark = await apiMark();
    expect(isBehindChangeMarks({ [key]: screen.applied }, { [key]: mark })).toBe(false);

    // 60秒：印が進む。画面は取り直すが、ページは別のインスタンスでも同じ印のデータを返す
    for (const second of [60, 65, 70]) {
      at(second * 1000);
      mark = await apiMark();
      if (isBehindChangeMarks({ [key]: screen.applied }, { [key]: mark })) screen = await pageShow();
    }
    expect(screen.label).toBe("v3");
    expect(screen.applied).toBe(mark);
    expect(calls).toBe(3);

    // 3つ目のインスタンス（メモリに何も無い）がページを出しても、取り直さずに同じ物を返す
    const other = await loadInstance();
    const third = await other.cachedRepoData(repo, load);
    expect(third.data.mainDeployedAt).toBe("v3");
    expect(third.changeMark).toBe(mark);
    expect(calls).toBe(3);
  });
});

describe("画面が使う設定の監視リポジトリ（Variable の値）を覚える", () => {
  const settingsRepo = { owner: "owner", repo: "settings" };
  let reads = 0;
  let value: string | null = "owner/a,owner/b";
  const read = async () => {
    reads++;
    return value;
  };

  beforeEach(() => {
    reads = 0;
    value = "owner/a,owner/b";
  });

  it("2回目からは GitHub を読まない（別のインスタンスでも）", async () => {
    expect(await page.cachedWatchedVariable(settingsRepo, "Owner1", read)).toBe("owner/a,owner/b");
    expect(await page.cachedWatchedVariable(settingsRepo, "owner1", read)).toBe("owner/a,owner/b");
    expect(await api.cachedWatchedVariable(settingsRepo, "owner1", read)).toBe("owner/a,owner/b");
    expect(reads).toBe(1);
  });

  it("Variable が無い（null）ことも覚える", async () => {
    value = null;
    expect(await page.cachedWatchedVariable(settingsRepo, "owner1", read)).toBeNull();
    expect(await page.cachedWatchedVariable(settingsRepo, "owner1", read)).toBeNull();
    expect(reads).toBe(1);
  });

  it("ログインした人ごとに別に覚える（ほかの人のトークンで読めた値を使わない）", async () => {
    await page.cachedWatchedVariable(settingsRepo, "owner1", read);
    const other = vi.fn(async () => "owner/c");
    expect(await page.cachedWatchedVariable(settingsRepo, "owner2", other)).toBe("owner/c");
    expect(other).toHaveBeenCalledTimes(1);
  });

  it("読めなかったとき（投げたとき）は覚えず、次にまた読む", async () => {
    const failing = async (): Promise<string | null> => {
      reads++;
      throw new Error("forbidden");
    };
    await expect(page.cachedWatchedVariable(settingsRepo, "owner1", failing)).rejects.toThrow();
    expect(await page.cachedWatchedVariable(settingsRepo, "owner1", read)).toBe("owner/a,owner/b");
    expect(reads).toBe(2);
  });

  it("設定を保存した（タグを無効にした）ら、次は読み直す", async () => {
    await page.cachedWatchedVariable(settingsRepo, "owner1", read);
    value = "owner/a";
    invalidate(page.WATCHED_REPOS_TAG);
    expect(await api.cachedWatchedVariable(settingsRepo, "owner1", read)).toBe("owner/a");
    expect(reads).toBe(2);
  });

  it("自動で足したあとは、返事を返し終えてから捨てる（その表示の間は覚えた物のまま、次の表示で読み直す）", async () => {
    await page.cachedWatchedVariable(settingsRepo, "owner1", read);
    value = "owner/a,owner/b,owner/new";
    page.forgetWatchedReposAfterResponse();
    expect(await page.cachedWatchedVariable(settingsRepo, "owner1", read)).toBe("owner/a,owner/b");
    for (const run of store.afterResponse) run();
    expect(await api.cachedWatchedVariable(settingsRepo, "owner1", read)).toBe("owner/a,owner/b,owner/new");
    expect(reads).toBe(2);
  });
});
