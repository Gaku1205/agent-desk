import { AuthError } from "@/components/AuthError";
import { getAuthErrorMessage } from "@/lib/authError";

export const metadata = { title: "ログインできません" };

/** ログインの拒否・エラーの画面（Auth.js の `pages.error`）。ログインは要らない */
export default async function AuthErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[] }>;
}) {
  const { error } = await searchParams;
  return <AuthError message={getAuthErrorMessage(error)} />;
}
