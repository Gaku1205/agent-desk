import { lampLabel, type Lamp } from "@/lib/lamp";
import styles from "./Conversation.module.css";

/**
 * 「いまの様子」のランプ（docs/design.md の「ランプ」）。線そのものは `<article>` の左に CSS で引く（飾り）。
 * ここは読み上げ用の隠し文字（`動作中`／`人間の手が必要`／`順番待ち 2番目`）。ランプなしは何も出さない
 */
export function LampLabel({ lamp }: { lamp: Lamp }) {
  const label = lampLabel(lamp);
  if (label === null) return null;
  return <span className={styles.srOnly}>{label}。</span>;
}

/** 順番待ちの待ち順：1行目の最後の ` · 2番目`（`--wait`）。読み上げは隠し文字がするので隠す */
export function LampWait({ lamp }: { lamp: Lamp }) {
  if (lamp.kind !== "waiting") return null;
  return (
    <>
      <span className={styles.sep} aria-hidden="true">
        ·
      </span>
      <span className={`${styles.wait} num`} aria-hidden="true">
        {lamp.position}番目
      </span>
    </>
  );
}
