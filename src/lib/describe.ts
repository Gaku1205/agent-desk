import { conflictKind, conflictText } from "./conflict";
import { failureReasonText, parseFailureReason } from "./failureReason";
import { trimTrailingPeriod } from "./humanRequest";
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
  /** その行のリポジトリ（`owner/repo`）。止まった理由のログのURLがこのリポジトリの物かを調べる */
  repo?: string;
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

/** パイプラインが動いていないリポジトリの未着手の説明文（docs/design.md の「段階ごとの説明文」） */
export const PIPELINE_MISSING_TEXT = "パイプライン未設定・Secretsを登録";

function ciText(status: IssueStatus): string {
  return `${status.ci.passed}/${status.ci.total}`;
}

/** 止まった・やり直し待ちの理由の文（パイプラインが書いた物）。それ以外の段階は null */
function failureReasonOf(status: IssueStatus): string | null {
  if (status.stage === "stuck") return status.stuckReason ?? "";
  if (status.stage === "retrying") return status.retry?.reason ?? "AIが止まりました";
  return null;
}

/** 止まった・やり直し待ちの理由に付いている、この行のリポジトリのログのURL（無ければ null） */
export function failureLogUrl(status: IssueStatus, repo: string): string | null {
  const reason = failureReasonOf(status);
  return reason === null ? null : parseFailureReason(reason, repo).logUrl;
}

/** 段階から、説明文（あなたの番用）と短い説明（パイプライン用）を決める（docs/design.md の「段階ごとの説明文」） */
export function describeStatus(status: IssueStatus, options: DescribeOptions = {}): Description {
  const ci = ciText(status);
  if (conflictKind(status)) {
    const text = conflictText("waiting");
    return { long: text, short: text };
  }
  switch (status.stage) {
    case "stuck":
      return {
        long: `${trimTrailingPeriod(failureReasonText(parseFailureReason(status.stuckReason ?? "", options.repo ?? "")))}。AIは自動では進められず止まっています。原因を確認して「再開」を押してください`,
        short: "止まっています",
      };
    case "retrying": {
      const count = status.retry ? `${status.retry.count}/${status.retry.max}回` : null;
      const reason = failureReasonText(
        parseFailureReason(status.retry?.reason ?? "AIが止まりました", options.repo ?? ""),
      );
      return {
        long: `${reason}${count ? `（${count}）` : ""}。AIが自動でやり直します。待つだけです`,
        short: count ? `やり直し待ち ${count}` : "やり直し待ち",
      };
    }
    case "notStarted":
      if (status.grace === "intake") {
        return { long: "受付が企画に回すか判断中。待つだけです", short: "受付中" };
      }
      return {
        long: "まだ誰にも頼んでいません。「おまかせ」か「実装を依頼」を押してください",
        short: "まだ頼んでいません",
      };
    case "queued":
      return { long: "順番待ち（前の作業の後）。待つだけです", short: "順番待ち" };
    case "skipped":
      if (status.paused) {
        return {
          long: `止めてあります：${status.paused.reason}。解除されるまで進みません`,
          short: "止めてある",
        };
      }
      return { long: "保留中です。準備ができたら「始める」を押してください", short: "保留中" };
    case "notice":
      return { long: "配り先で落ちた知らせです。内容を確認して閉じてください", short: "知らせ" };
    case "planning":
      return { long: "企画AIが清書中。待つだけです", short: "清書中" };
    case "question":
      return { long: "企画AIが質問しています。答えると、AIが続きを進めます", short: "質問があります" };
    case "factoryTalk":
      return {
        long: "工場（新しいサービスを作る仕組み）が相談しています。答えると、続きが進みます",
        short: "工場の相談",
      };
    case "implementing":
      return { long: "AIが実装中。待つだけです", short: "AIが実装中" };
    case "prWaiting":
      if (status.grace === "creatingPull") {
        return { long: "AIの作業が終わり、PR（変更のまとめ）を作成中。待つだけです", short: "PRを作成中" };
      }
      return status.implementError
        ? {
            long: "AIがエラーで止まりました。結果を確認して、続けるか判断してください",
            short: "AIがエラーで停止",
          }
        : {
            long: "AIの作業が終わりました。PR（変更のまとめ）を作ると、チェックとレビューに進みます",
            short: "PRを作れます",
          };
    case "ciRunning":
      if (status.verifyingFix) {
        return { long: `直した結果を確認中（CI ${ci}・レビュー）。待つだけです`, short: "修正を確認中" };
      }
      return { long: `CI（自動のチェック）を実行中 ${ci}。待つだけです`, short: `CI 実行中 ${ci}` };
    case "ciFailed":
      return {
        long: "CI（自動のチェック）が失敗しました。AIが自動で直します。待つだけです",
        short: "CIが失敗しました",
      };
    case "reviewing":
      if (status.verifyingFix) {
        return { long: `直した結果を確認中（CI ${ci}・レビュー）。待つだけです`, short: "修正を確認中" };
      }
      return { long: "レビューAIが確認中。待つだけです", short: "レビューAIが確認中" };
    case "fixing": {
      const max = status.fixLimit ?? MAX_AUTO_FIX;
      const n = Math.min(Math.max(status.fixCount, 1), max);
      const head = `AIが直しています（${n}/${max} 回目）`;
      return {
        long: `${options.fixReason ? `${head}：${options.fixReason}` : head}。待つだけです`,
        short: `AIが修正中 ${n}/${max}`,
      };
    }
    case "mergeWaiting":
      if (status.mergeWait === "hold") {
        return {
          long: status.holdRequest
            ? `${status.holdRequest}。確認してから「マージ…」を押してください`
            : `CI ${ci} 通過。内容を確認して、よければ「マージ…」を押してください`,
          short: "マージできます",
        };
      }
      if (status.mergeWait === "autoMerge") {
        return { long: "CI・レビューOK。まもなく自動でマージします。待つだけです", short: "自動でマージします" };
      }
      return { long: `CI ${ci} 通過。レビューに回します。待つだけです`, short: "レビューに回します" };
    case "deploying":
      return { long: "本番に公開中。待つだけです", short: "本番に公開中" };
    case "deployFailed":
      return {
        long: "公開に失敗しました。理由を確認して、直す依頼を出してください",
        short: "公開に失敗しました",
      };
    case "deployed":
      return status.deployUnknown
        ? { long: "公開されたか分かりません。公開先で確認してください", short: "公開状況は不明" }
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
      return status.grace === "intake" ? spec("half", "ai") : spec("dashed", "human");
    case "queued":
    case "retrying":
      return spec("dashed", "idle");
    case "skipped":
    case "notice":
      return spec("paused", "human");
    case "question":
    case "factoryTalk":
      return spec("dashed", "human");
    case "planning":
    case "ciRunning":
    case "reviewing":
    case "fixing":
    case "deploying":
      return spec("half", "ai");
    case "implementing":
      return { shape: "half", tone: "ai", spinning: true };
    case "prWaiting":
      return spec("half", status.grace === "creatingPull" ? "ai" : "human");
    case "ciFailed":
    case "deployFailed":
      return spec("cross", "fail");
    case "mergeWaiting":
      return spec("half", status.turn === "human" ? "human" : "ai");
    case "deployed":
      return spec("check", "done");
  }
}
