import { describe, expect, it } from "vitest";
import { failureReasonText, parseFailureReason } from "./failureReason";

const REPO = "Gaku1205/agent-desk";
const CAUSE = "許可不足（AIが許可されていない操作を試した：1件。最初の1件：Bash(git rebase main)）";
const URL = "https://github.com/Gaku1205/agent-desk/actions/runs/123456";
const reason = (url: string) => `実装AIがエラーで止まりました（原因：${CAUSE}。ログ：${url}）`;

describe("parseFailureReason", () => {
  it("説明・入れ子の原因・URLを取り出す", () => {
    expect(parseFailureReason(reason(URL), REPO)).toEqual({
      text: "実装AIがエラーで止まりました",
      cause: CAUSE,
      logUrl: URL,
    });
  });

  it("リポジトリ名の大文字小文字は区別しない", () => {
    expect(parseFailureReason(reason(URL), "gaku1205/AGENT-DESK").logUrl).toBe(URL);
  });

  it("原因・ログの無い文はそのまま", () => {
    const plain = "レビューの指摘が直りませんでした";
    expect(parseFailureReason(plain, REPO)).toEqual({ text: plain, cause: null, logUrl: null });
  });

  it("別のリポジトリのURLは採らない（URLは文に残さない）", () => {
    expect(
      parseFailureReason(reason("https://github.com/other/repo/actions/runs/1"), REPO),
    ).toEqual({ text: "実装AIがエラーで止まりました", cause: CAUSE, logUrl: null });
  });

  it("別のサイトのURL・数字でない実行番号は採らない", () => {
    expect(parseFailureReason(reason("https://example.com/actions/runs/1"), REPO).logUrl).toBeNull();
    expect(
      parseFailureReason(reason("https://github.com/Gaku1205/agent-desk/actions/runs/abc"), REPO).logUrl,
    ).toBeNull();
  });

  it("末尾の形が崩れた文はそのまま", () => {
    for (const broken of [
      `実装AIが止まりました（原因：${CAUSE}。ログ：${URL}`,
      `実装AIが止まりました（原因：${CAUSE}）`,
      `実装AIが止まりました。ログ：${URL}）`,
      `実装AIが止まりました（原因：。ログ：${URL}）`,
      `（原因：${CAUSE}。ログ：${URL}）`,
    ]) {
      expect(parseFailureReason(broken, REPO)).toEqual({ text: broken, cause: null, logUrl: null });
    }
  });
});

describe("failureReasonText", () => {
  it("説明（原因）にする", () => {
    expect(failureReasonText(parseFailureReason(reason(URL), REPO))).toBe(
      `実装AIがエラーで止まりました（${CAUSE}）`,
    );
  });

  it("原因が無ければ説明だけ", () => {
    expect(failureReasonText(parseFailureReason("止まりました", REPO))).toBe("止まりました");
  });
});
