import Link from "next/link";
import type { CSSProperties } from "react";
import { signIn } from "@/lib/auth";
import { DEMO_BASE_PATH } from "@/lib/demo/data";
import { getLoginScope } from "@/lib/loginScope";
import { PROGRESS_STAGE_NAMES } from "@/lib/progress";
import { Backdrop } from "./Backdrop";
import { LoginSubmit } from "./LoginSubmit";
import styles from "./LoginScreen.module.css";

/** ログイン画面：川の上に、画面いっぱいの極太のワードマークと、ログインのボタンだけ（スマホは上に段階の一覧） */
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
        {/* スマホだけ：ワードマークが幅いっぱいでも上が空くので、パイプラインの段階を縦に並べ、1つの光を通す */}
        <ol className={styles.stages} aria-hidden="true">
          {PROGRESS_STAGE_NAMES.map((name, i) => (
            <li key={name} style={{ "--i": i } as CSSProperties}>
              {name}
            </li>
          ))}
        </ol>
        <h1 className={styles.mark} aria-label="agent-desk">
          <span aria-hidden="true">agent-</span>
          <span aria-hidden="true">desk</span>
        </h1>
        <div className={styles.actions}>
          <form action={login}>
            <LoginSubmit />
          </form>
          <Link className={styles.demoLink} href={DEMO_BASE_PATH}>
            ログインせずにデモを見る
          </Link>
        </div>
      </main>
    </>
  );
}
