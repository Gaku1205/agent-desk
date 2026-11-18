import { DeskSkeleton } from "@/components/Skeleton";

/**
 * リポジトリのページから別のリポジトリのページへ移るときの骨組み。
 * `(app)/loading.tsx` は、同じ `/repos/…` の中の移動では出ない（変わる区切りより上にあるため）ので、ここにも置く
 */
export default function Loading() {
  return <DeskSkeleton />;
}
