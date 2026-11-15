import Link from "next/link";
import { signIn } from "@/lib/auth";
import { DEMO_BASE_PATH } from "@/lib/demo/data";
import { getLoginScope } from "@/lib/loginScope";
import { LoginSubmit } from "./LoginSubmit";
import styles from "./LoginScreen.module.css";

/** ログイン画面：1本の列の真ん中に、ワードマークとログインのボタンだけ */
export function LoginScreen() {
  async function login() {
    "use server";
    // 頼む権限は、ログインを始めるときだけ決める（画面を開くたびには調べない）
    await signIn("github", undefined, { scope: await getLoginScope() });
  }

  return (
    <main className={styles.login}>
      <h1 className={styles.mark}>agent-desk</h1>
      <div className={styles.actions}>
        <form action={login}>
          <LoginSubmit />
        </form>
        <Link className={styles.demoLink} href={DEMO_BASE_PATH}>
          ログインせずにデモを見る
        </Link>
      </div>
    </main>
  );
}
