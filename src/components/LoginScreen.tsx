import Link from "next/link";
import { signIn } from "@/lib/auth";
import { DEMO_BASE_PATH } from "@/lib/demo/data";
import { getLoginScope } from "@/lib/loginScope";
import styles from "./LoginScreen.module.css";

export function LoginScreen() {
  async function login() {
    "use server";
    // 頼む権限は、ログインを始めるときだけ決める（画面を開くたびには調べない）
    await signIn("github", undefined, { scope: await getLoginScope() });
  }

  return (
    <main className={styles.login}>
      <form action={login}>
        <button type="submit" className={styles.button}>
          GitHubでログイン
        </button>
      </form>
      <Link className={styles.demoLink} href={DEMO_BASE_PATH}>
        ログインせずにデモを見る
      </Link>
    </main>
  );
}
