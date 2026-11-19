import type { Metadata } from "next";
import { notFound } from "next/navigation";

export const metadata: Metadata = { title: "ページが見つかりません · デモ" };

/**
 * `/demo` の下でどのページにも当たらないURL。デモの中で 404 にして、`demo/not-found.tsx` を出す
 * （これが無いと、上の `(app)/[...missing]` に当たり、デモの外の画面になる）
 */
export default function DemoMissing() {
  notFound();
}
