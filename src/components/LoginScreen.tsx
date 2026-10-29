import Link from "next/link";
import { signIn } from "@/lib/auth";
import { DEMO_BASE_PATH } from "@/lib/demo/data";
import { getLoginScope } from "@/lib/loginScope";
import { Backdrop } from "./Backdrop";
import styles from "./LoginScreen.module.css";

/** ログイン画面：川の上に巨大なワードマークと、ログインのボタンだけ */
export function LoginScreen() {
  async function login() {
    "use server";
    // 頼む権限は、ログインを始めるときだけ決める（画面を開くたびには調べない）
    await signIn("github", undefined, { scope: await getLoginScope() });
  }

  return (
    <>
      <Backdrop />
      <main className={styles.login}>
        <h1 className={styles.mark} aria-label="agent-desk">
          agent-desk
        </h1>
        <div className={styles.actions}>
          <form action={login}>
            <button type="submit" className={styles.button}>
              GitHubでログイン
            </button>
          </form>
          <Link className={styles.demoLink} href={DEMO_BASE_PATH}>
            ログインせずにデモを見る
          </Link>
        </div>
      </main>
    </>
  );
}
