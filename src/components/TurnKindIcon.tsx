import type { TurnIcon } from "@/lib/turnKind";

/** 種類の札の左の記号（docs/design.md の「あなたの番の種類と色」）。線だけ・色は文字と同じ（currentColor） */
export function TurnKindIcon({ icon, size = 14 }: { icon: TurnIcon; size?: number }) {
  return (
    <svg
      className="kind-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flexShrink: 0, alignSelf: "center" }}
    >
      {shape(icon)}
    </svg>
  );
}

function shape(icon: TurnIcon) {
  switch (icon) {
    case "stuck": // ×の丸
      return (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="m15 9-6 6M9 9l6 6" />
        </>
      );
    case "deployFailed": // 注意の三角
      return (
        <>
          <path d="M10.3 3.9 2.4 17.5A2 2 0 0 0 4.1 20.5h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
          <path d="M12 9.5v4M12 17h.01" />
        </>
      );
    case "notice": // ベル
      return (
        <>
          <path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15Z" />
          <path d="M10 20.5a2 2 0 0 0 4 0" />
        </>
      );
    case "merge": // 枝の合流
      return (
        <>
          <circle cx="6" cy="5" r="2.2" />
          <circle cx="18" cy="15" r="2.2" />
          <path d="M6 7.2V19M18 12.8V12a4 4 0 0 0-4-4H10" />
          <path d="m12 6-2 2 2 2" />
        </>
      );
    case "question": // ？の丸
      return (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M9.5 9.5a2.5 2.5 0 1 1 3.6 2.2c-.7.4-1.1.9-1.1 1.8M12 17h.01" />
        </>
      );
    case "factoryTalk": // 吹き出し
      return <path d="M21 12a8 8 0 0 1-11.7 7.1L3 20.5l1.4-4.9A8 8 0 1 1 21 12Z" />;
    case "prPending": // プルリクエスト
      return (
        <>
          <circle cx="6" cy="5.5" r="2.2" />
          <circle cx="6" cy="18.5" r="2.2" />
          <circle cx="18" cy="18.5" r="2.2" />
          <path d="M6 7.7v8.6M18 16.3V9a3 3 0 0 0-3-3h-3" />
          <path d="m14 3-2.5 3L14 9" />
        </>
      );
    case "notStarted": // 点線の丸
      return <circle cx="12" cy="12" r="9" strokeDasharray="3 3.4" />;
    case "onHold": // 一時停止
      return (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M10 9v6M14 9v6" />
        </>
      );
    case "pending":
      return <circle cx="12" cy="12" r="9" />;
  }
}
