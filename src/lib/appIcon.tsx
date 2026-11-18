import { ImageResponse } from "next/og";

/**
 * アプリのアイコン（docs/design.md の「アプリのアイコン」）の PNG を作る。
 * 絵は src/app/icon.svg と同じ数値（64×64 の座標）を、出したい大きさに拡大して描く。
 * 外の角丸は付けない四角（iOS の apple-icon と、Android の maskable 用。切り抜きは OS がする）
 */

const GROUND = "#4f46e5";
const GREEN = "#3fb950";

/** 棒：[x, y, 幅]。高さは8。左の先だけ半径4、右の端は半径1.5 */
const BARS: ReadonlyArray<{ x: number; y: number; w: number; fill: string }> = [
  { x: 21, y: 17, w: 17.5, fill: GREEN },
  { x: 14, y: 28, w: 24.5, fill: "rgba(255,255,255,1)" },
  { x: 18, y: 39, w: 20.5, fill: "rgba(255,255,255,0.55)" },
];

export function renderAppIcon(size: number): ImageResponse {
  const k = size / 64;
  return new ImageResponse(
    (
      <div
        style={{
          width: size,
          height: size,
          background: GROUND,
          position: "relative",
          display: "flex",
        }}
      >
        {BARS.map((b) => (
          <div
            key={b.y}
            style={{
              position: "absolute",
              left: b.x * k,
              top: b.y * k,
              width: b.w * k,
              height: 8 * k,
              background: b.fill,
              borderRadius: `${4 * k}px ${1.5 * k}px ${1.5 * k}px ${4 * k}px`,
            }}
          />
        ))}
        <div
          style={{
            position: "absolute",
            left: 41 * k,
            top: 17 * k,
            width: 8 * k,
            height: 30 * k,
            background: "#ffffff",
            borderRadius: 1.5 * k,
          }}
        />
      </div>
    ),
    { width: size, height: size },
  );
}
