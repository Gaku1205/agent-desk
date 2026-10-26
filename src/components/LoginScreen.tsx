import Link from "next/link";
import { signIn } from "@/lib/auth";
import { DEMO_BASE_PATH } from "@/lib/demo/data";

export function LoginScreen() {
  async function login() {
    "use server";
    await signIn("github");
  }

  return (
    <main className="login">
      <form action={login}>
        <button type="submit" className="login-button">
          GitHubでログイン
        </button>
      </form>
      <Link className="login-demo-link" href={DEMO_BASE_PATH}>
        ログインせずにデモを見る
      </Link>
    </main>
  );
}
