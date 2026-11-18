/** 期間の切り替え（横に並ぶタブ）のキー操作：←→ で隣（端では反対の端へ回る）、Home・End で最初・最後。ほかのキーは null（動かさない） */
export function nextTabIndex(key: string, current: number, count: number): number | null {
  if (count <= 0) return null;
  switch (key) {
    case "ArrowRight":
      return (current + 1) % count;
    case "ArrowLeft":
      return (current - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}
