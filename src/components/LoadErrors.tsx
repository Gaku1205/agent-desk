import type { DeskError } from "./Desk";
import styles from "./LoadErrors.module.css";

/** 読めなかったリポジトリがあるとき、数や一覧に入っていないことを添える一文 */
export const LOAD_ERRORS_NOTE = "読めなかったリポジトリの分は、このページの数・一覧に入っていません";

/**
 * 読めなかったリポジトリの知らせ（Slots & Queue・Dashboard・すべてのリポジトリ）。
 * 読めなかった分を「0件」「何もない」と見せないため、ページの見出しの下に `owner/repo：理由` を1行ずつ出す。無ければ何も描かない
 */
export function LoadErrors({ errors }: { errors: DeskError[] }) {
  if (errors.length === 0) return null;
  return (
    <ul className={styles.errors} role="alert">
      {errors.map((error) => (
        <li key={`${error.repo}|${error.message}`}>
          {error.work ? `${error.repo} ${error.message}` : `${error.repo}：${error.message}`}
        </li>
      ))}
      {errors.some((error) => !error.work) && <li className={styles.note}>{LOAD_ERRORS_NOTE}</li>}
    </ul>
  );
}
