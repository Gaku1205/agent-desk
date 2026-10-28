import { deployKind, isFailedState, latestPerContext } from "./deployStatus";
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
 * 公開失敗の理由：公開ステータスを context ごとに最新の物にして、failure・error の物の description を出す。
 * description が空の物は除く。失敗が Vercel の1つだけなら description だけ、
 * それ以外は `{種類}：{説明}` を1行ずつ。出す物が無ければ null
 */
export function deployFailureReason(statuses: CommitStatusData[]): string | null {
  const failed = latestPerContext(statuses)
    .filter((s) => isFailedState(s.state))
    .flatMap((s) => {
      const message = deployFailureMessage(s.description);
      return message === null ? [] : [{ context: s.context, message }];
    });
  if (failed.length === 0) return null;
  if (failed.length === 1 && failed[0].context.startsWith("Vercel")) return failed[0].message;
  return failed.map((f) => `${deployKind(f.context)}：${f.message}`).join("\n");
}
