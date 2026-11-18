/**
 * 順番待ちの印（紫の砂時計。docs/design.md の「順番待ちの印」）。順番待ちを出す所は全部ここから出す。
 * 線だけ・太さ1.8・角丸、色は `--wait`。意味は横の文字か隠し文字が伝えるので `aria-hidden`
 */
export function QueueIcon({ size = 12 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={{ color: "var(--wait)", flexShrink: 0, display: "inline-block", verticalAlign: "middle" }}
    >
      <path d="M6 3h12M6 21h12M7 3c0 5 10 5 10 9s-10 4-10 9M17 3c0 5-10 5-10 9s10 4 10 9" />
    </svg>
  );
}
