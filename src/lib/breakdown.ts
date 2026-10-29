/** 巨大な数字の下の、リポジトリごとの内訳（docs/design.md の「巨大な数字」） */

/** 数の大きさ：いちばん少ない（0件）と、いちばん多いリポジトリ */
export const BREAKDOWN_MIN_PX = 22;
export const BREAKDOWN_MAX_PX = 56;

export type BreakdownRow = { repo: string; count: number; size: number };

/**
 * 件数の多い順（同じなら名前の順）に並べ、数の大きさを `22px + 34px × 件数 ÷ いちばん多い件数` にする。
 * 全部0件なら全部 22px
 */
export function repoBreakdown(repos: readonly { repo: string; count: number }[]): BreakdownRow[] {
  const max = Math.max(0, ...repos.map((r) => r.count));
  return [...repos]
    .sort((a, b) => b.count - a.count || a.repo.localeCompare(b.repo))
    .map(({ repo, count }) => ({
      repo,
      count,
      size: max > 0 ? Math.round((BREAKDOWN_MIN_PX + ((BREAKDOWN_MAX_PX - BREAKDOWN_MIN_PX) * count) / max) * 10) / 10 : BREAKDOWN_MIN_PX,
    }));
}
