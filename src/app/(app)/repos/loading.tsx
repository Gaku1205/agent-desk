import { RepoListSkeleton } from "@/components/Skeleton";

/**
 * すべてのリポジトリ（`/repos`）を読んでいる間の骨組み（回る印・文字は出さない）。
 * リポジトリのページ（`/repos/…`）から来るときは、上の階層の `(app)/loading.tsx` が出ず、前の中身が残ったままになるので、ここに置く。
 * リポジトリのページを読んでいる間は、より内側の `[owner]/[repo]/loading.tsx` が出る
 */
export default function Loading() {
  return <RepoListSkeleton />;
}
