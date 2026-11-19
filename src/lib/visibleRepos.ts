import type { TurnCounts } from "./turn";

type RepoRef = { owner: string; repo: string };

/**
 * 今開いているリポジトリ（`/repos/<owner>/<repo>`、デモは `/demo/repos/...`）。
 * それ以外（`/repos` の一覧、ホームなど）は null
 */
export function currentRepoFromPath(pathname: string): RepoRef | null {
  const match = /^(?:\/demo)?\/repos\/([^/]+)\/([^/]+)\/?$/.exec(pathname);
  if (!match) return null;
  try {
    return { owner: decodeURIComponent(match[1]), repo: decodeURIComponent(match[2]) };
  } catch {
    return null;
  }
}

/**
 * 左のバー・スマホのメニューに札を出すリポジトリ：あなたの番かAIの番が1件以上ある物。
 * 今開いているリポジトリと、読めなかったリポジトリは 0・0 でも出す。並びは入力のまま
 */
export function visibleRepos<T extends RepoRef>(
  repos: T[],
  turnCounts: TurnCounts,
  runningCounts: TurnCounts,
  current: RepoRef | null,
  unreadable: Record<string, true> = {},
): T[] {
  const currentKey = current ? `${current.owner}/${current.repo}`.toLowerCase() : null;
  return repos.filter((r) => {
    const key = `${r.owner}/${r.repo}`.toLowerCase();
    // 読めなかったリポジトリは、数が分からないので札を消さない（数は「–」）
    return key === currentKey || unreadable[key] === true ||(turnCounts.byRepo[key] ?? 0) > 0 || (runningCounts.byRepo[key] ?? 0) > 0;
  });
}
