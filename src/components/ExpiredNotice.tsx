"use client";

import { useSearchParams } from "next/navigation";
import { EXPIRED_MESSAGE, EXPIRED_REASON } from "@/lib/authExpired";
import styles from "./LoginScreen.module.css";

/** ログイン画面の、認証が切れた理由の1行（`?reason=expired` のときだけ。ページを移れば消える） */
export function ExpiredNotice() {
  const reason = useSearchParams().get("reason");
  if (reason !== EXPIRED_REASON) return null;
  return (
    <p className={styles.notice} role="status">
      {EXPIRED_MESSAGE}
    </p>
  );
}
