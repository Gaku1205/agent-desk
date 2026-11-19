"use client";

import styles from "./Switch.module.css";

/** スイッチの見た目だけ（つまみと地）。押せる物は外側の `role="switch"` のボタンが持つ */
export function SwitchTrack({ on }: { on: boolean }) {
  return (
    <span className={styles.track} data-on={on ? "" : undefined} aria-hidden="true">
      <span className={styles.thumb} />
    </span>
  );
}

type Props = {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** 読み上げの名前 */
  label: string;
  disabled?: boolean;
};

/** オン・オフのスイッチ（`<button role="switch" aria-checked>`）。docs/design.md の「並列の状態のボタン」と同じ見た目 */
export function Switch({ checked, onChange, label, disabled }: Props) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={styles.button}
      data-pre-tap=""
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <SwitchTrack on={checked} />
    </button>
  );
}
