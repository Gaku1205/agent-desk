import type { RepoResult } from "./github/types";

/** 読めなかったリポジトリと理由（画面に出す。理由は固定の日本語の文で、トークンや返事の中身は入らない） */
export type LoadError = {
  repo: string;
  message: string;
  /** リポジトリは読めたが、どの区画にも出せない作業の行（`状態が読めない`）。リポジトリの数を `–` にはしない */
  work?: true;
};

/** 取得結果から、読めなかったリポジトリだけを `owner/repo` と理由にして返す（並びは取得結果の順） */
export function loadErrorsOf(results: RepoResult[]): LoadError[] {
  return results.flatMap((result) =>
    result.ok ? [] : [{ repo: `${result.owner}/${result.repo}`, message: result.error.message }],
  );
}
