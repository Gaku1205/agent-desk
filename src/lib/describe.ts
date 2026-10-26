import { MAX_AUTO_FIX, type IssueStatus } from "./status";

export type Description = {
  /** 「あなたの番」に出す説明文 */
  long: string;
  /** パイプライン表に出す短い説明 */
  short: string;
};

export type DescribeOptions = {
  /** 修正中のときの「CIの失敗」か「レビューの指摘」（分かるときだけ） */
  fixReason?: string;
};

/** 状態アイコンの形 */
export type IconShape = "dashed" | "paused" | "half" | "check" | "cross";
/** 状態アイコンの色（誰の番か） */
export type IconTone = "human" | "ai" | "done" | "fail" | "idle";

export type IconSpec = {
  shape: IconShape;
  tone: IconTone;
  /** 半分塗りをゆっくり回す（AI作業中） */
  spinning: boolean;
};

function ciText(status: IssueStatus): string {
  return `${status.ci.passed}/${status.ci.total}`;
}

/** 段階から、説明文（あなたの番用）と短い説明（パイプライン用）を決める（docs/design.md の「段階ごとの説明文」） */
export function describeStatus(status: IssueStatus, options: DescribeOptions = {}): Description {
  const ci = ciText(status);
  switch (status.stage) {
    case "stuck":
      return {
        long: `${status.stuckReason ?? ""}。確認して、対応したら「再開」を押してください`,
        short: "止まっています",
      };
    case "notStarted":
      return { long: "まだ誰にも頼んでいません", short: "まだ頼んでいません" };
    case "queued":
      return { long: "前の作業が終わったら自動で始まります", short: "順番待ち" };
    case "skipped":
      return { long: "保留中です。準備ができたら「始める」を押してください", short: "保留中" };
    case "planning":
      return { long: "企画AIがIssueを清書中", short: "清書中" };
    case "implementing":
      return { long: "AIが実装中", short: "AIが実装中" };
    case "prWaiting":
      return status.implementError
        ? {
            long: "AIがエラーで止まりました。結果を確認してPRを作ってください",
            short: "AIがエラーで停止",
          }
        : { long: "AIの作業が終わりました。PRを作るとCIが走ります", short: "PRを作れます" };
    case "ciRunning":
      if (status.verifyingFix) {
        return { long: `直した結果を確認中（CI ${ci}・レビュー）`, short: "修正を確認中" };
      }
      return { long: `CI 実行中 ${ci}`, short: `CI 実行中 ${ci}` };
    case "ciFailed":
      return { long: "CIが失敗しました。AIに直してもらいます", short: "CIが失敗しました" };
    case "reviewing":
      if (status.verifyingFix) {
        return { long: `直した結果を確認中（CI ${ci}・レビュー）`, short: "修正を確認中" };
      }
      return { long: "レビューAIが確認中", short: "レビューAIが確認中" };
    case "fixing": {
      const n = Math.min(Math.max(status.fixCount, 1), MAX_AUTO_FIX);
      const head = `AIが直しています（${n}/${MAX_AUTO_FIX} 回目）`;
      return {
        long: options.fixReason ? `${head}：${options.fixReason}` : head,
        short: `AIが修正中 ${n}/${MAX_AUTO_FIX}`,
      };
    }
    case "mergeWaiting":
      if (status.mergeWait === "hold") {
        return { long: `CI ${ci} 通過・マージできます`, short: "マージできます" };
      }
      if (status.mergeWait === "autoMerge") {
        return { long: "CIもレビューもOK・自動でマージします", short: "自動でマージします" };
      }
      return { long: `CI ${ci} 通過・レビューに回します`, short: "レビューに回します" };
    case "deploying":
      return { long: "本番に公開中", short: "本番に公開中" };
    case "deployFailed":
      return { long: "公開に失敗しました", short: "公開に失敗しました" };
    case "deployed":
      return status.deployUnknown
        ? { long: "公開状況は不明", short: "公開状況は不明" }
        : { long: "本番に公開済み", short: "公開済み" };
  }
}

/** 段階から、状態アイコンの形と色を決める（docs/design.md の「アイコン（状態）」） */
export function statusIconSpec(status: IssueStatus): IconSpec {
  const spec = (shape: IconShape, tone: IconTone): IconSpec => ({
    shape,
    tone,
    spinning: false,
  });
  switch (status.stage) {
    case "stuck":
      return spec("cross", "human");
    case "notStarted":
      return spec("dashed", "human");
    case "queued":
      return spec("dashed", "idle");
    case "skipped":
      return spec("paused", "human");
    case "planning":
    case "ciRunning":
    case "reviewing":
    case "fixing":
    case "deploying":
      return spec("half", "ai");
    case "implementing":
      return { shape: "half", tone: "ai", spinning: true };
    case "prWaiting":
      return spec("half", "human");
    case "ciFailed":
    case "deployFailed":
      return spec("cross", "fail");
    case "mergeWaiting":
      return spec("half", status.turn === "human" ? "human" : "ai");
    case "deployed":
      return spec("check", "done");
  }
}
