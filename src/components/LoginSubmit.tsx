"use client";

import { useFormStatus } from "react-dom";
import styles from "./LoginScreen.module.css";

/** ログインのボタン：送信の最中（GitHub へ移る間）は文言を変え、押せなくする */
export function LoginSubmit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={styles.button} disabled={pending}>
      {pending ? "GitHubへ移動中…" : "GitHubでログイン"}
    </button>
  );
}
