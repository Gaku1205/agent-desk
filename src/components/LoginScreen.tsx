import Link from "next/link";
import { signIn } from "@/lib/auth";
import { DEMO_BASE_PATH } from "@/lib/demo/data";
import styles from "./LoginScreen.module.css";

export function LoginScreen() {
  async function login() {
    "use server";
    await signIn("github");
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
