import type { WatchedRepo } from "./config";
import { checkRepoList } from "./repoSetting";

// 設定で保存した「監視するリポジトリ」を、ページをまたいで残る部品（上端の帯・左のバー・メニューの札）へすぐ反映する
// （docs/spec.md の「監視するリポジトリ」）。ブラウザでも使うので、サーバーだけの物は import しない

/** 保存した監視リポジトリを別タブへ知らせる BroadcastChannel の名前 */
export const WATCHED_REPOS_CHANNEL = "agent-desk:watched-repos";

/** 保存した一覧と、そのとき画面が持っていたサーバーの一覧（これが新しくなったら、保存した一覧は役目を終える） */
export type SavedRepos<T> = { repos: WatchedRepo[]; base: T };

/**
 * 保存した名前の並び（`owner/repo`）を、札に出すリポジトリの並びにする。
 * 形が違う・空の物は null（別タブから届いた物も、これで確かめてから使う）
 */
export function parseSavedRepos(value: unknown): WatchedRepo[] | null {
  const checked = checkRepoList(value);
  return checked.ok ? checked.repos : null;
}

/**
 * 札に出すリポジトリ：保存した一覧があり、サーバーの一覧がそのときのままなら、保存した一覧。
 * サーバーの一覧が新しくなった（保存のあとの取り直しが届いた）ら、サーバーの一覧
 */
export function reposToShow<T extends readonly WatchedRepo[]>(base: T, saved: SavedRepos<T> | null): readonly WatchedRepo[] {
  return saved !== null && saved.base === base ? saved.repos : base;
}
