import type { ReactNode } from "react";
import type { FlowStepKey } from "@/lib/flow";

/** 線だけのアイコン（Lucide と同じ形・線の太さ1.5。パッケージは入れずに SVG で書く） */
function LineIcon({ size, children }: { size: number; children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      {children}
    </svg>
  );
}

/** 進捗図の工程のアイコン：企画＝電球、デザイン＝ペン、実装＝コード、CI＝チェック付きの盾、レビュー＝目、修正＝レンチ、公開＝ロケット */
export function FlowStepIcon({ step, size = 17 }: { step: FlowStepKey; size?: number }) {
  switch (step) {
    case "plan":
      return (
        <LineIcon size={size}>
          <path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5" />
          <path d="M9 18h6" />
          <path d="M10 22h4" />
        </LineIcon>
      );
    case "design":
      return (
        <LineIcon size={size}>
          <path d="M15.707 21.293a1 1 0 0 1-1.414 0l-1.586-1.586a1 1 0 0 1 0-1.414l5.586-5.586a1 1 0 0 1 1.414 0l1.586 1.586a1 1 0 0 1 0 1.414z" />
          <path d="m18 13-1.375-6.874a1 1 0 0 0-.746-.776L3.235 2.028a1 1 0 0 0-1.207 1.207L5.35 15.879a1 1 0 0 0 .776.746L13 18" />
          <path d="m2.3 2.3 7.286 7.286" />
          <circle cx="11" cy="11" r="2" />
        </LineIcon>
      );
    case "implement":
      return (
        <LineIcon size={size}>
          <path d="m16 18 6-6-6-6" />
          <path d="m8 6-6 6 6 6" />
        </LineIcon>
      );
    case "ci":
      return (
        <LineIcon size={size}>
          <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
          <path d="m9 12 2 2 4-4" />
        </LineIcon>
      );
    case "review":
      return (
        <LineIcon size={size}>
          <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
          <circle cx="12" cy="12" r="3" />
        </LineIcon>
      );
    case "fix":
      return (
        <LineIcon size={size}>
          <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
        </LineIcon>
      );
    case "deploy":
      return (
        <LineIcon size={size}>
          <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
          <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
          <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" />
          <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
        </LineIcon>
      );
  }
}

/** 進捗図の状態の印：成功＝チェック */
export function CheckIcon({ size = 14 }: { size?: number }) {
  return (
    <LineIcon size={size}>
      <path d="M20 6 9 17l-5-5" />
    </LineIcon>
  );
}

/** 進捗図の状態の印：失敗＝× */
export function CrossIcon({ size = 14 }: { size?: number }) {
  return (
    <LineIcon size={size}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </LineIcon>
  );
}

/** 止まった理由：許可＝鍵 */
export function KeyIcon({ size = 17 }: { size?: number }) {
  return (
    <LineIcon size={size}>
      <circle cx="7.5" cy="15.5" r="4.5" />
      <path d="m10.7 12.3 9.8-9.8M16 7l3 3M14 9l2 2" />
    </LineIcon>
  );
}

/** 止まった理由：人間の確認待ち＝人 */
export function PersonIcon({ size = 17 }: { size?: number }) {
  return (
    <LineIcon size={size}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </LineIcon>
  );
}

/** 進捗図の状態の印：進行中＝円の4分の3の弧（CSS で回す） */
export function SpinnerIcon({ size = 14 }: { size?: number }) {
  return (
    <LineIcon size={size}>
      <path d="M21 12a9 9 0 1 1-9-9" />
    </LineIcon>
  );
}

/** ラベルの左に置くアイコンの大きさ（docs/design.md の「アイコン」） */
const LABEL = 16;

type IconProps = { size?: number };

export function HomeIcon({ size = LABEL }: IconProps) {
  return (
    <LineIcon size={size}>
      <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" />
    </LineIcon>
  );
}

export function TriangleDownIcon() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M2 3.5h6L5 7z" />
    </svg>
  );
}

export function TriangleUpIcon() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M2 6.5h6L5 3z" />
    </svg>
  );
}

export function FileIcon({ size = LABEL }: IconProps) {
  return (
    <LineIcon size={size}>
      <path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h6" />
      <path d="M9 17h6" />
    </LineIcon>
  );
}

/** 全部＝グリッド */
export function GridIcon({ size = LABEL }: IconProps) {
  return (
    <LineIcon size={size}>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
    </LineIcon>
  );
}

/** リポジトリ＝フォルダ */
export function RepoIcon({ size = LABEL }: IconProps) {
  return (
    <LineIcon size={size}>
      <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
    </LineIcon>
  );
}

/** チップ（Dashboard の AI usage の見出し） */
export function ChipIcon({ size = LABEL }: IconProps) {
  return (
    <LineIcon size={size}>
      <rect x="5" y="5" width="14" height="14" rx="2" />
      <rect x="9" y="9" width="6" height="6" rx="1" />
      <path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" />
    </LineIcon>
  );
}

/** 上向きの矢印（Dashboard の Throughput） */
export function ArrowUpIcon({ size = LABEL }: IconProps) {
  return (
    <LineIcon size={size}>
      <path d="M12 20V5" />
      <path d="m5 12 7-7 7 7" />
    </LineIcon>
  );
}

/** メーター（Dashboard の GitHub limits）：半円の目盛りと針 */
export function GaugeIcon({ size = LABEL }: IconProps) {
  return (
    <LineIcon size={size}>
      <path d="M4 18a8 8 0 1 1 16 0" />
      <path d="M12 18l4-5" />
      <path d="M12 7v1.5M6.3 9.3l1 1M17.7 9.3l-1 1" />
    </LineIcon>
  );
}

/** Slots & Queue＝横線3本 */
export function LanesIcon({ size = LABEL }: IconProps) {
  return (
    <LineIcon size={size}>
      <path d="M4 6h16" />
      <path d="M4 12h16" />
      <path d="M4 18h16" />
    </LineIcon>
  );
}

/** Slots の見出し＝3列の箱 */
export function ColumnsIcon({ size = LABEL }: IconProps) {
  return (
    <LineIcon size={size}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M9 3v18" />
      <path d="M15 3v18" />
    </LineIcon>
  );
}

/** 空きの枠（Free）＝丸 */
export function CircleIcon({ size = LABEL }: IconProps) {
  return (
    <LineIcon size={size}>
      <circle cx="12" cy="12" r="8" />
    </LineIcon>
  );
}

/** 棒グラフ（Dashboard） */
export function ChartIcon({ size = LABEL }: IconProps) {
  return (
    <LineIcon size={size}>
      <path d="M3 21h18" />
      <path d="M6 21V12" />
      <path d="M12 21V4" />
      <path d="M18 21v-6" />
    </LineIcon>
  );
}

/** Issueを書く＝ペン付きの四角 */
export function WriteIcon({ size = LABEL }: IconProps) {
  return (
    <LineIcon size={size}>
      <path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z" />
    </LineIcon>
  );
}

/** 送る＝↵（Lucide の corner-down-left） */
export function EnterIcon({ size = LABEL }: IconProps) {
  return (
    <LineIcon size={size}>
      <path d="M20 4v7a4 4 0 0 1-4 4H4" />
      <path d="m9 10-5 5 5 5" />
    </LineIcon>
  );
}

/** 画像を付ける＝山と太陽の入った四角 */
export function ImageIcon({ size = LABEL }: IconProps) {
  return (
    <LineIcon size={size}>
      <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
    </LineIcon>
  );
}

/** ログアウト＝出る矢印 */
export function LogoutIcon({ size = LABEL }: IconProps) {
  return (
    <LineIcon size={size}>
      <path d="m16 17 5-5-5-5" />
      <path d="M21 12H9" />
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    </LineIcon>
  );
}

/** ログイン＝入る矢印 */
export function LoginIcon({ size = LABEL }: IconProps) {
  return (
    <LineIcon size={size}>
      <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
      <path d="m10 17 5-5-5-5" />
      <path d="M15 12H3" />
    </LineIcon>
  );
}

/** GitHubで見る＝枝分かれ */
export function BranchIcon({ size = LABEL }: IconProps) {
  return (
    <LineIcon size={size}>
      <path d="M6 3v12" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M18 9a9 9 0 0 1-9 9" />
    </LineIcon>
  );
}

/** 再生・作る＝三角 */
export function PlayIcon({ size = LABEL }: IconProps) {
  return (
    <LineIcon size={size}>
      <path d="M6 3 20 12 6 21z" />
    </LineIcon>
  );
}

/** 保存＝フロッピー */
export function SaveIcon({ size = LABEL }: IconProps) {
  return (
    <LineIcon size={size}>
      <path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
      <path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7" />
      <path d="M7 3v4a1 1 0 0 0 1 1h7" />
    </LineIcon>
  );
}

/** 追加＝＋ */
export function PlusIcon({ size = LABEL }: IconProps) {
  return (
    <LineIcon size={size}>
      <path d="M5 12h14" />
      <path d="M12 5v14" />
    </LineIcon>
  );
}

/** 左のバーを畳む・開く＝左に縦線のある四角（Lucide の panel-left） */
export function PanelLeftIcon({ size = LABEL }: IconProps) {
  return (
    <LineIcon size={size}>
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M9 3v18" />
    </LineIcon>
  );
}

/** 通知＝ベル */
export function BellIcon({ size = LABEL }: IconProps) {
  return (
    <LineIcon size={size}>
      <path d="M10.268 21a2 2 0 0 0 3.464 0" />
      <path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326" />
    </LineIcon>
  );
}

/** テーマ＝太陽 */
export function SunIcon({ size = LABEL }: IconProps) {
  return (
    <LineIcon size={size}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="m4.93 4.93 1.41 1.41" />
      <path d="m17.66 17.66 1.41 1.41" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="m6.34 17.66-1.41 1.41" />
      <path d="m19.07 4.93-1.41 1.41" />
    </LineIcon>
  );
}

/** アニメーション＝波形 */
export function ActivityIcon({ size = LABEL }: IconProps) {
  return (
    <LineIcon size={size}>
      <path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2" />
    </LineIcon>
  );
}

/** キーボード操作＝キーボード */
export function KeyboardIcon({ size = LABEL }: IconProps) {
  return (
    <LineIcon size={size}>
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="M6 8h.01" />
      <path d="M10 8h.01" />
      <path d="M14 8h.01" />
      <path d="M18 8h.01" />
      <path d="M8 12h.01" />
      <path d="M12 12h.01" />
      <path d="M16 12h.01" />
      <path d="M7 16h10" />
    </LineIcon>
  );
}

/** 全部ちがう＝戻す矢印 */
export function RedoIcon({ size = LABEL }: IconProps) {
  return (
    <LineIcon size={size}>
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
    </LineIcon>
  );
}

/** 直す＝レンチ */
export function WrenchIcon({ size = LABEL }: IconProps) {
  return <FlowStepIcon step="fix" size={size} />;
}

/** 質問・相談の選択肢の印：丸（選んだら丸にチェック） */
export function OptionMarkIcon({ checked, size = LABEL }: IconProps & { checked: boolean }) {
  return (
    <LineIcon size={size}>
      <circle cx="12" cy="12" r="9" />
      {checked && <path d="m8.5 12.5 2.5 2.5 4.5-5" />}
    </LineIcon>
  );
}

export function GearIcon({ size = LABEL }: IconProps) {
  return (
    <LineIcon size={size}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </LineIcon>
  );
}
