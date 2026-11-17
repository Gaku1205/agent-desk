import Link from "next/link";
import styles from "./AuthError.module.css";

/** ログインの拒否・エラーの画面：ワードマーク・理由の1行・ログイン画面へ戻るリンク */
export function AuthError({ message }: { message: string }) {
  return (
    <main className={styles.page}>
      <h1 className={styles.mark}>agent-desk</h1>
      <p className={styles.reason} role="alert">
        {message}
      </p>
      <Link className={styles.back} href="/">
        ログイン画面へ戻る
      </Link>
    </main>
  );
}
