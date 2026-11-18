import { FormSkeleton } from "@/components/Skeleton";

/** Issueを書く画面を読んでいる間の骨組み（新しいサービスを作る画面は、その下の loading.tsx） */
export default function Loading() {
  return <FormSkeleton />;
}
