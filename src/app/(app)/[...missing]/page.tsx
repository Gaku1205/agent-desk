import { notFound } from "next/navigation";

export const metadata = { title: "ページが見つかりません" };

/**
 * どのページにも当たらないURL。(app) の中で 404 にして、ログインの確認とサイドバーを通す
 * （ログインしていなければログインボタン、していれば (app)/not-found.tsx）
 */
export default function Missing() {
  notFound();
}
