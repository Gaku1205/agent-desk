import { describe, expect, it } from "vitest";
import { deployFailureReason } from "./deployFailure";
import { deployKind, deployLinks, isDeployStatus, latestPerContext } from "./deployStatus";
import type { CommitStatusData } from "./github/types";
import { deployState, latestSuccessDeployByContext } from "./status";

const NOW = new Date("2026-10-25T12:00:00Z");
const MERGED = "2026-10-25T11:50:00Z";

function st(
  context: string,
  state: string,
  updatedAt = "2026-10-25T11:55:00Z",
  extra: Partial<CommitStatusData> = {},
): CommitStatusData {
  return { context, state, description: "", updatedAt, ...extra };
}

describe("isDeployStatus", () => {
  it("Vercel で始まる物と deploy/ で始まる物だけ true", () => {
    expect(isDeployStatus("Vercel")).toBe(true);
    expect(isDeployStatus("Vercel – agent-desk")).toBe(true);
    expect(isDeployStatus("deploy/aws-apprunner")).toBe(true);
    expect(isDeployStatus("deploy/github-release")).toBe(true);
    expect(isDeployStatus("deploy/expo")).toBe(true);
    expect(isDeployStatus("ci/other")).toBe(false);
    expect(isDeployStatus("deployment")).toBe(false);
    expect(isDeployStatus("")).toBe(false);
  });
});

describe("deployKind", () => {
  it("deploy/ の後ろ。Vercel は Vercel", () => {
    expect(deployKind("deploy/aws-apprunner")).toBe("aws-apprunner");
    expect(deployKind("Vercel")).toBe("Vercel");
  });
});

describe("latestPerContext", () => {
  it("context ごとに updatedAt が最新の物を残し、公開ステータス以外は除く", () => {
    const result = latestPerContext([
      st("deploy/expo", "pending", "2026-10-25T11:51:00Z"),
      st("deploy/expo", "success", "2026-10-25T11:58:00Z"),
      st("ci/other", "failure"),
    ]);
    expect(result.map((s) => `${s.context}:${s.state}`)).toEqual(["deploy/expo:success"]);
  });
});

describe("deployState（deploy/ の context）", () => {
  it("success は公開済み、pending は公開中、error は公開失敗", () => {
    expect(deployState([st("deploy/aws-apprunner", "success")], MERGED, NOW).state).toBe("deployed");
    expect(deployState([st("deploy/aws-apprunner", "pending")], MERGED, NOW).state).toBe("deploying");
    expect(deployState([st("deploy/aws-apprunner", "error")], MERGED, NOW).state).toBe("failed");
  });

  it("どれかが failure なら、ほかが success でも公開失敗", () => {
    const statuses = [st("deploy/aws-apprunner", "failure"), st("deploy/github-release", "success")];
    expect(deployState(statuses, MERGED, NOW).state).toBe("failed");
  });

  it("失敗が無くどれかが pending なら公開中、全部 success なら公開済み", () => {
    expect(
      deployState([st("deploy/aws-apprunner", "pending"), st("deploy/github-release", "success")], MERGED, NOW).state,
    ).toBe("deploying");
    expect(
      deployState([st("deploy/aws-apprunner", "success"), st("deploy/github-release", "success")], MERGED, NOW).state,
    ).toBe("deployed");
  });

  it("失敗した context は、同じ context が後で成功すれば解決ずみ。別の context の success では解決しない", () => {
    const statuses = [st("deploy/aws-apprunner", "failure"), st("deploy/github-release", "success")];
    const sameContext = { "deploy/aws-apprunner": "2026-10-25T11:58:00Z" };
    const otherContext = { "deploy/github-release": "2026-10-25T11:58:00Z" };
    expect(deployState(statuses, MERGED, NOW, sameContext).state).toBe("deployed");
    expect(deployState(statuses, MERGED, NOW, otherContext).state).toBe("failed");
  });

  it("文字列の時刻は、どの context にも使う（今までの Vercel と同じ）", () => {
    expect(deployState([st("Vercel", "failure")], MERGED, NOW, "2026-10-25T11:58:00Z").state).toBe("deployed");
  });
});

describe("latestSuccessDeployByContext", () => {
  it("context ごとの最新の success。Vercel の Ignored Build Step は数えない", () => {
    const result = latestSuccessDeployByContext([
      st("deploy/aws-apprunner", "success", "2026-10-25T11:00:00Z"),
      st("deploy/aws-apprunner", "success", "2026-10-25T11:30:00Z"),
      st("deploy/expo", "pending", "2026-10-25T11:40:00Z"),
      st("Vercel", "success", "2026-10-25T11:50:00Z", { description: "Canceled by Ignored Build Step" }),
    ]);
    expect(result).toEqual({ "deploy/aws-apprunner": "2026-10-25T11:30:00Z" });
  });
});

describe("deployFailureReason（複数の公開先）", () => {
  it("失敗した context を {種類}：{説明} で1行ずつ", () => {
    const reason = deployFailureReason([
      st("deploy/aws-apprunner", "failure", undefined, { description: "AWS の設定がまだです（Variable：AWS_REGION）" }),
      st("deploy/github-release", "success"),
      st("deploy/expo", "error", undefined, { description: "Expo のトークンがありません" }),
    ]);
    expect(reason).toBe(
      "aws-apprunner：AWS の設定がまだです（Variable：AWS_REGION）\nexpo：Expo のトークンがありません",
    );
  });

  it("Vercel だけが失敗のときは今までどおり説明だけ", () => {
    expect(deployFailureReason([st("Vercel", "failure", undefined, { description: "boom" })])).toBe("boom");
  });

  it("description が空なら null", () => {
    expect(deployFailureReason([st("deploy/aws-apprunner", "failure")])).toBeNull();
  });
});

describe("deployLinks", () => {
  it("success で https:// の target_url がある物だけ。1つなら 開く", () => {
    const links = deployLinks([
      st("deploy/aws-apprunner", "success", undefined, { targetUrl: "https://abc.awsapprunner.com" }),
      st("deploy/expo", "success", undefined, { targetUrl: "http://example.com" }),
      st("deploy/github-release", "success"),
    ]);
    expect(links).toEqual([{ label: "開く", url: "https://abc.awsapprunner.com" }]);
  });

  it("複数なら種類の名前つき。知らない種類は deploy/ の後ろそのまま", () => {
    const links = deployLinks([
      st("deploy/aws-apprunner", "success", undefined, { targetUrl: "https://a.example" }),
      st("deploy/github-release", "success", undefined, { targetUrl: "https://b.example" }),
      st("deploy/expo", "success", undefined, { targetUrl: "https://c.example" }),
      st("deploy/other", "success", undefined, { targetUrl: "https://d.example" }),
    ]);
    expect(links.map((l) => l.label)).toEqual(["App Runner", "Releases", "Expo", "other"]);
  });

  it("success でない物と、target_url が無い物は出さない", () => {
    expect(deployLinks([st("deploy/expo", "failure", undefined, { targetUrl: "https://run.example" })])).toEqual([]);
    expect(deployLinks([st("deploy/expo", "success")])).toEqual([]);
  });
});
