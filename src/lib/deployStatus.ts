import type { CommitStatusData } from "./github/types";

/** 公開を飛ばしたコミットのVercelのステータスの説明（パイプラインの更新だけのコミットは Ignored Build Step が公開を止める） */
export const IGNORED_BUILD_DESCRIPTION = "Canceled by Ignored Build Step";

const VERCEL = "Vercel";
const DEPLOY_PREFIX = "deploy/";

/** 公開ステータスか：context が `Vercel` で始まる、または `deploy/` で始まる */
export function isDeployStatus(context: string): boolean {
  return context.startsWith(VERCEL) || context.startsWith(DEPLOY_PREFIX);
}

/** main の最後に公開が成功した時刻：全 context 共通の時刻、または context ごとの時刻 */
export type MainDeployedTimes = string | null | Record<string, string>;

function isLater(time: string | null | undefined, base: string | null): boolean {
  if (!time || !base) return false;
  const t = Date.parse(time);
  const b = Date.parse(base);
  return !Number.isNaN(t) && !Number.isNaN(b) && t > b;
}

/**
 * 失敗した公開の context が、あとの公開で解決ずみか（段階の判定と失敗の理由で共通）。
 * Vercel の context：Vercel で始まるどれかの context が、マージより後に成功していれば解決ずみ。
 * それ以外（`deploy/` など）：同じ context が、マージより後に成功していれば解決ずみ。
 * mainDeployed が文字列のときは、どの context にも同じ時刻を使う
 */
export function isDeployResolved(context: string, mergedAt: string | null, mainDeployed: MainDeployedTimes): boolean {
  if (typeof mainDeployed !== "object" || mainDeployed === null) return isLater(mainDeployed, mergedAt);
  if (context.startsWith(VERCEL)) {
    return Object.entries(mainDeployed).some(([key, at]) => key.startsWith(VERCEL) && isLater(at, mergedAt));
  }
  return isLater(mainDeployed[context], mergedAt);
}

/** 公開先の種類の名前：`deploy/` の後ろ。Vercel は「Vercel」 */
export function deployKind(context: string): string {
  return context.startsWith(DEPLOY_PREFIX) ? context.slice(DEPLOY_PREFIX.length) : VERCEL;
}

/** 公開ステータスだけを取り、context ごとに updatedAt が最新の物を1つずつ残す（context の古い順） */
export function latestPerContext(statuses: CommitStatusData[]): CommitStatusData[] {
  const latest = new Map<string, CommitStatusData>();
  for (const status of statuses) {
    if (!isDeployStatus(status.context)) continue;
    const current = latest.get(status.context);
    if (!current || status.updatedAt.localeCompare(current.updatedAt) >= 0) latest.set(status.context, status);
  }
  return [...latest.values()];
}

/**
 * 公開ステータスのうち数えられる物を、context ごとの最新で返す。
 * 最新が「飛ばした物」（Vercel の Ignored Build Step の success）の context は除く
 * （飛ばした物しか無いコミットは、公開ステータスが無いのと同じ扱いにする）。failure・error・pending は残す
 */
export function latestCountedPerContext(statuses: CommitStatusData[]): CommitStatusData[] {
  return latestPerContext(statuses).filter((s) => s.state !== "success" || isCountedDeploySuccess(s));
}

/** 失敗か：failure・error */
export function isFailedState(state: string): boolean {
  return state === "failure" || state === "error";
}

/** 公開の成功に数えるか：success で、Vercel の context なら説明が「Canceled by Ignored Build Step」ではない（前後の空白は無視） */
export function isCountedDeploySuccess(status: CommitStatusData): boolean {
  if (!isDeployStatus(status.context) || status.state !== "success") return false;
  return !(status.context.startsWith(VERCEL) && status.description.trim() === IGNORED_BUILD_DESCRIPTION);
}

const KIND_LABEL: Record<string, string> = {
  "aws-apprunner": "App Runner",
  "github-release": "Releases",
  expo: "Expo",
};

/** 公開先へのリンク（公開済みの行用） */
export type DeployLink = { label: string; url: string };

/**
 * 公開済みの行のリンク：context ごとの最新が success で、`target_url` が `https://` で始まる物。
 * 1つだけなら `開く ↗`、複数なら種類の名前つき（`App Runner ↗` `Releases ↗` `Expo ↗`。それ以外は `deploy/` の後ろそのまま）
 */
export function deployLinks(statuses: CommitStatusData[]): DeployLink[] {
  const found = latestPerContext(statuses).filter(
    (s) => s.state === "success" && typeof s.targetUrl === "string" && s.targetUrl.startsWith("https://"),
  );
  return found.map((s) => {
    const kind = deployKind(s.context);
    return {
      label: found.length === 1 ? "開く" : (KIND_LABEL[kind] ?? kind),
      url: s.targetUrl as string,
    };
  });
}
