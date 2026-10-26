import type { CommitStatusData } from "./github/types";

/** 「rate limited — retry in 24 hours.」の形（数字と単位 minute／hour／day を取り出す） */
const RATE_LIMITED = /rate limited\s*[-—–]+\s*retry in\s+(\d+)\s+(minute|hour|day)s?/i;

const UNIT_JA = { minute: "分", hour: "時間", day: "日" } as const;

/** 公開失敗の理由に使う description を、表示する文言にする。空なら null */
export function deployFailureMessage(description: string): string | null {
  const text = description.trim();
  if (text === "") return null;
  const match = RATE_LIMITED.exec(text);
  if (match) {
    const unit = UNIT_JA[match[2].toLowerCase() as keyof typeof UNIT_JA];
    return `利用上限に達しました。あと${Number(match[1])}${unit}で再開します`;
  }
  return text;
}

/**
 * 公開失敗の理由：公開ステータス（context が `Vercel` で始まる）のうち failure・error で
 * updatedAt が最新のものの description。description が空なら null
 */
export function deployFailureReason(statuses: CommitStatusData[]): string | null {
  const latest = statuses
    .filter((s) => s.context.startsWith("Vercel") && (s.state === "failure" || s.state === "error"))
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
    .at(-1);
  return latest ? deployFailureMessage(latest.description) : null;
}
