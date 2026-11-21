"use client";

/**
 * しばらく操作が無いタブで自動更新を止めているときの、画面の下の小さな帯（docs/design.md の「操作が無いタブの帯」）。
 * 押すと1回作り直して、自動更新を再開する
 */
export function IdleBand({ onRefresh }: { onRefresh: () => void }) {
  return (
    <div
      role="status"
      data-testid="idle-band"
      style={{
        position: "fixed",
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 40,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        padding: "10px var(--gutter, 16px)",
        background: "var(--bg)",
        borderTop: "1px solid var(--hair)",
        color: "var(--bone-2)",
        fontSize: 13,
      }}
    >
      <span>しばらく操作が無いので、自動更新を止めています。再開するには「最新にする」を押してください</span>
      <button
        type="button"
        onClick={onRefresh}
        style={{
          padding: "6px 12px",
          borderRadius: 8,
          border: "1px solid var(--edge)",
          background: "transparent",
          color: "var(--bone)",
          font: "inherit",
          cursor: "pointer",
        }}
      >
        最新にする
      </button>
    </div>
  );
}
