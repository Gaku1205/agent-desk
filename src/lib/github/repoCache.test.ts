import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isBehindChangeMarks, repoChangeKey } from "../changeMarks";
import type { RepoData } from "./types";

// Next.js のキャッシュの代わり：キーごとに覚え、タグを無効にしたら捨てる。全部のインスタンスで共有する（Vercel と同じ）。
// 保存は取り終わってから行うので、取得の途中の無効化は保存で上書きされる（Next.js と同じ）
const store = vi.hoisted(() => ({
  entries: new Map<string, { value: unknown; tags: string[] }>(),
}));

function invalidate(tag: string) {
  for (const [key, entry] of store.entries) {
    if (entry.tags.includes(tag)) store.entries.delete(key);
  }
}

vi.mock("next/cache", () => ({
  unstable_cache:
    <T>(fn: () => Promise<T>, keyParts: string[], options: { tags?: string[] }) =>
    async (): Promise<T> => {
      const key = keyParts.join("|");
      const known = store.entries.get(key);
      if (known) return known.value as T;
      const value = await fn();
      store.entries.set(key, { value, tags: options.tags ?? [] });
      return value;
    },
  revalidateTag: invalidate,
  updateTag: invalidate,
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
const { repoTag } = await import("../webhook");

function data(label: string): RepoData {
  return { mainDeployedAt: label } as unknown as RepoData;
}

const START = new Date("2026-01-01T00:00:00Z").getTime();
let counter = 0;
let repo = { owner: "owner", repo: "repo0" };
let calls = 0;
const load = async () => data(`v${++calls}`);

/** Webhook が来た（タグを無効にする） */
function webhook() {
  invalidate(repoTag(repo));
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
  repo = { owner: "owner", repo: `repo${++counter}` };
  calls = 0;
  vi.useFakeTimers({ toFake: ["Date"] });
  at(0);
});
afterEach(() => vi.useRealTimers());

describe("取り直しの下限（同じリポジトリは最短15秒あける）", () => {
  it("5秒おきに変わり続けても、最初の取り直しは15秒たってから。そのあとは間隔を30秒・60秒と延ばす", async () => {
    await pageShow(); // 0秒：最初の1回
    const fetchedAt: number[] = [];
    for (let second = 5; second <= 300; second += 5) {
      at(second * 1000);
      webhook();
      await apiMark();
      const before = calls;
      await pageShow();
      if (calls > before) fetchedAt.push(second);
    }
    // 15秒あけて1回、30秒あけて1回、そのあとは60秒ごと
    expect(fetchedAt).toEqual([15, 45, 105, 165, 225, 285]);
  });

  it("変わり続けたあと、2分静かなら、次の変化はまた15秒の間隔に戻る", async () => {
    await pageShow();
    for (let second = 5; second <= 110; second += 5) {
      at(second * 1000);
      webhook();
      await apiMark();
      await pageShow();
    }
    // 15・45・105秒に取り直して、あける時間は60秒になっている。105秒から2分以上静かにする
    const busyCalls = calls;
    at(230_000);
    webhook();
    await apiMark();
    await pageShow(); // 静かなあとの最初の変化は、すぐ
    expect(calls).toBe(busyCalls + 1);
    at(240_000);
    webhook();
    await apiMark();
    await pageShow(); // 10秒後：まだ15秒たっていない
    expect(calls).toBe(busyCalls + 1);
    at(245_000);
    await apiMark();
    await pageShow(); // 15秒後：取り直す（60秒は待たない）
    expect(calls).toBe(busyCalls + 2);
  });

  it("あける時間は、別のインスタンスが印を進めても同じに効く", async () => {
    await pageShow();
    const others = [await loadInstance(), await loadInstance(), await loadInstance()];
    const fetchedAt: number[] = [];
    for (let second = 5; second <= 120; second += 5) {
      at(second * 1000);
      webhook();
      await others[(second / 5) % others.length].getChangeMarks([repo]);
      const before = calls;
      await pageShow();
      if (calls > before) fetchedAt.push(second);
    }
    expect(fetchedAt).toEqual([15, 45, 105]);
  });

  it("15秒の間の最後の変化も、15秒たった次の取り直しで出る", async () => {
    await pageShow();
    at(3000);
    webhook();
    await apiMark();
    expect((await pageShow()).label).toBe("v1");
    at(14_000);
    webhook(); // 最後の変化
    await apiMark();
    expect((await pageShow()).label).toBe("v1");
    at(15_000);
    await apiMark();
    expect((await pageShow()).label).toBe("v2");
    // まとめて1回だけ。そのあとは変わっていないので取り直さない
    at(40_000);
    await apiMark();
    expect((await pageShow()).label).toBe("v2");
    expect(calls).toBe(2);
  });

  it("静かなあとの最初の変化は、すぐ取り直す", async () => {
    await pageShow();
    at(10 * 60_000);
    webhook();
    await apiMark();
    expect((await pageShow()).label).toBe("v2");
  });

  it("印は、取り直してよい時になって初めて進む", async () => {
    const first = await pageShow();
    expect(await apiMark()).toBe(first.applied);

    at(3000);
    webhook();
    expect(await apiMark()).toBe(first.applied); // 待っている間は進まない
    at(10_000);
    webhook();
    expect(await apiMark()).toBe(first.applied);

    at(15_000);
    const markAfter = await apiMark();
    expect(markAfter).not.toBe(first.applied);
    const shown = await pageShow();
    expect(shown.label).toBe("v2");
    expect(shown.applied).toBe(markAfter);
    expect(await apiMark()).toBe(markAfter);
  });

  it("手で押す「同期」・ボタン操作の後は、下限を無視してすぐ取り直す", async () => {
    await pageShow();
    at(1000);
    webhook();
    await apiMark();
    expect((await pageShow()).label).toBe("v1");
    const markBefore = await apiMark();

    at(2000);
    page.invalidateRepoNow(repo);
    const shown = await pageShow();
    expect(shown.label).toBe("v2");
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

    // 画面は「印 > 反映済み」の間は取り直す。15秒たてば印が進み、取り直しで変化が出る
    at(5000);
    const waiting = await apiMark();
    expect(isBehindChangeMarks({ [repoChangeKey(repo)]: first.changeMark }, { [repoChangeKey(repo)]: waiting })).toBe(
      false,
    );
    at(15_000);
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

    // 3秒：変化。/api/changes は別のインスタンスでも15秒たつまで印を進めない
    at(3000);
    webhook();
    let mark = await apiMark();
    expect(isBehindChangeMarks({ [key]: screen.applied }, { [key]: mark })).toBe(false);

    // 15秒：印が進む。画面は取り直すが、ページは別のインスタンスでも同じ印のデータを返す
    for (const second of [15, 20, 25]) {
      at(second * 1000);
      mark = await apiMark();
      if (isBehindChangeMarks({ [key]: screen.applied }, { [key]: mark })) screen = await pageShow();
    }
    expect(screen.label).toBe("v2");
    expect(screen.applied).toBe(mark);
    expect(calls).toBe(2);

    // 3つ目のインスタンス（メモリに何も無い）がページを出しても、取り直さずに同じ物を返す
    const other = await loadInstance();
    const third = await other.cachedRepoData(repo, load);
    expect(third.data.mainDeployedAt).toBe("v2");
    expect(third.changeMark).toBe(mark);
    expect(calls).toBe(2);
  });
});
