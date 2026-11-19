import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isBehindChangeMarks, repoChangeKey } from "../changeMarks";
import type { RepoData } from "./types";

// Next.js のキャッシュの代わり：キーごとに覚え、タグを無効にしたら捨てる。全部のインスタンスで共有する（Vercel と同じ）。
// 保存は取り終わってから行うので、取得の途中の無効化は保存で上書きされる（Next.js と同じ）
const store = vi.hoisted(() => ({
  entries: new Map<string, { value: unknown; tags: string[]; at?: number }>(),
  /** 寿命（`revalidate`）を過ぎた物を、すぐ返して裏で作り直す動きも真似るか（Next.js と同じ。寿命を使うテストだけ） */
  swr: false,
  /** 裏で作り直している物 */
  background: [] as Promise<unknown>[],
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
    <T>(fn: () => Promise<T>, keyParts: string[], options?: { tags?: string[]; revalidate?: number }) =>
    async (): Promise<T> => {
      const key = keyParts.join("|");
      const known = store.entries.get(key);
      const save = (value: T) => store.entries.set(key, { value, tags: options?.tags ?? [], at: Date.now() });
      if (known) {
        const stale =
          store.swr && options?.revalidate !== undefined && Date.now() - (known.at ?? 0) > options.revalidate * 1000;
        // 寿命を過ぎた物は、すぐ返して裏で作り直す（作り直しが失敗したら、前の物のまま）
        if (stale) store.background.push(fn().then(save, () => undefined));
        return known.value as T;
      }
      const value = await fn();
      save(value);
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
  return { mainDeployedAt: label, issues: [{ number: 1 }], pulls: [] } as unknown as RepoData;
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
  store.swr = false;
  store.background.length = 0;
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

describe("大きいデータも覚えられるように、縮めて覚える", () => {
  /** Issue が多いリポジトリ：JSON にして 2MB を超える */
  function bigData(): RepoData {
    const issues = Array.from({ length: 400 }, (_, number) => ({
      number,
      title: `Issue ${number}`,
      body: `本文 ${number} `.repeat(300),
      comments: Array.from({ length: 5 }, (_, id) => ({ id, body: `コメント ${number}-${id} `.repeat(120) })),
    }));
    return { issues } as unknown as RepoData;
  }

  it("縮めた物は元に戻る（日本語も）", () => {
    const value = { title: "計測マーク", nested: [1, null, { ok: true }] };
    expect(page.unpackCached(page.packCached(value))).toEqual(value);
  });

  it("JSON にして 2MB を超えるデータも、覚える物は 2MB より小さい文字列になり、次は取り直さない", async () => {
    const big = bigData();
    expect(JSON.stringify(big).length).toBeGreaterThan(2 * 1024 * 1024);
    let loads = 0;
    const loadBig = async () => {
      loads++;
      return big;
    };
    expect((await page.cachedRepoData(repo, loadBig)).data).toEqual(big);
    const stored = [...store.entries.entries()].find(([key]) => key.startsWith("repo-data-gz|"));
    expect(typeof stored?.[1].value).toBe("string");
    expect(JSON.stringify(stored?.[1].value).length).toBeLessThan(2 * 1024 * 1024);
    // 別のインスタンスでも、覚えた物から同じデータが読める
    const other = await loadInstance();
    expect((await other.cachedRepoData(repo, loadBig)).data).toEqual(big);
    expect(loads).toBe(1);
  });
});

describe("覚えている最後の結果（古くてよい）を、新しい結果が遅いときに先に出す", () => {
  const app = (label: string, mark: string) => ({ data: data(label), changeMark: mark });
  /** 外から終わらせられる取得 */
  function pending<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  beforeEach(() => {
    store.swr = true;
  });

  it("覚えている物が無ければ、新しい結果を待って返し、それを覚える", async () => {
    expect(await page.snapshotRepoData(repo, Promise.resolve(app("v1", "m1")))).toEqual(app("v1", "m1"));
  });

  it("覚えている物があれば、新しい結果を待たずにすぐ返し、裏で新しい結果に書き直す（別のインスタンスでも）", async () => {
    await page.snapshotRepoData(repo, Promise.resolve(app("v1", "m1")));
    at(5000);
    const slow = pending<ReturnType<typeof app>>();
    // 新しい結果（v2）はまだ届いていないが、前の物がすぐ返る
    expect(await api.snapshotRepoData(repo, slow.promise)).toEqual(app("v1", "m1"));
    slow.resolve(app("v2", "m2"));
    await Promise.all(store.background);
    at(10_000);
    const other = await loadInstance();
    expect(await other.snapshotRepoData(repo, pending<ReturnType<typeof app>>().promise)).toEqual(app("v2", "m2"));
  });

  it("新しい結果が失敗したら、覚えている物はそのまま残る。覚えている物が無ければ null", async () => {
    const failed = Promise.reject(new Error("failed"));
    failed.catch(() => undefined);
    expect(await page.snapshotRepoData(repo, failed)).toBeNull();
    await page.snapshotRepoData(repo, Promise.resolve(app("v1", "m1")));
    at(5000);
    expect(await page.snapshotRepoData(repo, failed)).toEqual(app("v1", "m1"));
    await Promise.all(store.background);
    at(10_000);
    expect(await page.snapshotRepoData(repo, failed)).toEqual(app("v1", "m1"));
  });

  it("空になった読みは、覚えている最後の良い結果を上書きしない（回数制限の時間帯の後に開いても空を出さない）", async () => {
    const emptyApp = { data: { mainDeployedAt: "empty", issues: [], pulls: [] } as unknown as RepoData, changeMark: "m0" };
    // 覚えている物が無いときの空の読みは、覚えない
    expect(await page.snapshotRepoData(repo, Promise.resolve(emptyApp))).toBeNull();
    await page.snapshotRepoData(repo, Promise.resolve(app("v1", "m1")));
    at(5000);
    expect(await page.snapshotRepoData(repo, Promise.resolve(emptyApp))).toEqual(app("v1", "m1"));
    await Promise.all(store.background);
    at(10_000);
    expect(await page.snapshotRepoData(repo, pending<ReturnType<typeof app>>().promise)).toEqual(app("v1", "m1"));
  });

  it("手で押す「同期」（タグの無効化）でも、覚えている物は消えない（取り直している間に出すため）", async () => {
    await page.snapshotRepoData(repo, Promise.resolve(app("v1", "m1")));
    page.invalidateRepoNow(repo);
    webhook({ urgent: true });
    at(5000);
    expect(await page.snapshotRepoData(repo, pending<ReturnType<typeof app>>().promise)).toEqual(app("v1", "m1"));
  });
});

describe("ログインした人が読めると確かめた結果を、どのインスタンスでも読めるように覚える", () => {
  beforeEach(() => {
    store.swr = true;
  });

  it("10分の間は、別のインスタンスでも確かめ直さない", async () => {
    const check = vi.fn(async () => true);
    expect(await page.cachedUserCanRead("token-a", repo, check)).toBe(true);
    at(9 * 60_000);
    expect(await api.cachedUserCanRead("token-a", repo, check)).toBe(true);
    expect(check).toHaveBeenCalledTimes(1);
  });

  it("10分より古い物は使わず、確かめ直す（読めなくなっていたら、すぐ false）", async () => {
    let readable = true;
    const check = vi.fn(async () => readable);
    await page.cachedUserCanRead("token-a", repo, check);
    readable = false;
    at(11 * 60_000);
    expect(await api.cachedUserCanRead("token-a", repo, check)).toBe(false);
  });

  it("トークンごと・リポジトリごとに別に覚える（ほかの人が読めた結果を使わない）", async () => {
    await page.cachedUserCanRead("token-a", repo, async () => true);
    const other = vi.fn(async () => false);
    expect(await page.cachedUserCanRead("token-b", repo, other)).toBe(false);
    expect(other).toHaveBeenCalledTimes(1);
    expect(JSON.stringify([...store.entries.keys()])).not.toContain("token-a");
  });

  it("確かめる処理が投げたら false（覚えない）", async () => {
    const failing = vi.fn(async (): Promise<boolean> => {
      throw new Error("network");
    });
    expect(await page.cachedUserCanRead("token-a", repo, failing)).toBe(false);
    expect(await page.cachedUserCanRead("token-a", repo, async () => true)).toBe(true);
  });
});
