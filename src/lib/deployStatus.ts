import type { CommitStatusData } from "./github/types";

/** 公開を飛ばしたコミットのVercelのステータスの説明（パイプラインの更新だけのコミットは Ignored Build Step が公開を止める） */
export const IGNORED_BUILD_DESCRIPTION = "Canceled by Ignored Build Step";

const VERCEL = "Vercel";
const DEPLOY_PREFIX = "deploy/";

/** 公開ステータスか：context が `Vercel` で始まる、または `deploy/` で始まる */
export function isDeployStatus(context: string): boolean {
  return context.startsWith(VERCEL) || context.startsWith(DEPLOY_PREFIX);
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
