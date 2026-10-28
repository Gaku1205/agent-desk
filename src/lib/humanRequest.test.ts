import { describe, expect, it } from "vitest";
import type { CommentData } from "./github/types";
import {
  holdRequestText,
  humanRequestReason,
  pullRequestAsks,
  trimTrailingPeriod,
} from "./humanRequest";

let nextId = 1;
function comment(overrides: Partial<CommentData> = {}): CommentData {
  return {
    id: nextId++,
    issueNumber: 3,
    author: "claude[bot]",
    body: "",
    createdAt: "2026-10-25T10:00:00Z",
    ...overrides,
  };
}

describe("humanRequestReason", () => {
  it("印の行より後の最初の空でない行を理由にする", () => {
    const result = humanRequestReason(
      [comment({ body: "<!-- human-request -->\n\n  `zod` を依存に足してください。  \n\n詳しい説明" })],
      3,
    );
    expect(result?.reason).toBe("`zod` を依存に足してください。");
  });

  it("最新のコメントを使う", () => {
    const result = humanRequestReason(
      [
        comment({ body: "<!-- human-request -->\n古い", createdAt: "2026-10-25T09:00:00Z" }),
        comment({ body: "<!-- human-request -->\n新しい", createdAt: "2026-10-25T11:00:00Z" }),
        comment({ body: "<!-- human-request -->\n中間", createdAt: "2026-10-25T10:00:00Z" }),
      ],
      3,
    );
    expect(result).toEqual({ reason: "新しい", createdAt: "2026-10-25T11:00:00Z" });
  });

  it("作者が claude[bot] 以外のコメントは使わない", () => {
    expect(
      humanRequestReason([comment({ author: "Gaku1205", body: "<!-- human-request -->\n理由" })], 3),
    ).toBeNull();
  });

  it("別のIssueのコメントや、印が無いコメントは使わない", () => {
    expect(
      humanRequestReason(
        [
          comment({ issueNumber: 4, body: "<!-- human-request -->\n理由" }),
          comment({ body: "理由だけ" }),
        ],
        3,
      ),
    ).toBeNull();
  });

  it("理由が空なら無いものとする", () => {
    expect(humanRequestReason([comment({ body: "<!-- human-request -->\n  \n\n" })], 3)).toBeNull();
  });

  it("コメントが無ければ null", () => {
    expect(humanRequestReason([], 3)).toBeNull();
  });
});

describe("pullRequestAsks / holdRequestText", () => {
  const body = (section: string) => `Closes #3\n\n## 何を変えたか\nあれこれ\n\n${section}\n\n## 受け入れ条件\n- [x] ok`;

  it("「人間にお願いしたいこと」の節の箇条書き3行 → 1行目とほか2件", () => {
    const text = holdRequestText(
      body("## 人間にお願いしたいこと\n- 秘密情報を登録する\n* ワークフローを確認する\n1. 本番で動かす"),
    );
    expect(text).toBe("マージの前に：秘密情報を登録する（ほか2件）");
  });

  it("1行だけなら（ほか）を付けない", () => {
    expect(holdRequestText(body("### 人間にお願いしたいこと\n\n- 秘密情報を登録する\n"))).toBe(
      "マージの前に：秘密情報を登録する",
    );
  });

  it("見出しの一部に含めばよい（# の数は問わない）", () => {
    expect(holdRequestText(body("# 5. 人間にお願いしたいこと（あれば）\n登録してください"))).toBe(
      "マージの前に：登録してください",
    );
  });

  it("無ければ「人間が手で確認すべきこと」の節を使う", () => {
    expect(holdRequestText(body("## 人間が手で確認すべきこと\n- 画面を見る"))).toBe(
      "マージの前に：画面を見る",
    );
  });

  it("「人間にお願いしたいこと」を先に探す", () => {
    const text = holdRequestText(
      "## 人間が手で確認すべきこと\n- 確認\n\n## 人間にお願いしたいこと\n- お願い",
    );
    expect(text).toBe("マージの前に：お願い");
  });

  it("節の中身が「なし」「特になし」「無し」・空なら null", () => {
    for (const content of ["なし", "- 特になし", "* 無し", "", "  \n\n"]) {
      expect(holdRequestText(body(`## 人間にお願いしたいこと\n${content}`))).toBeNull();
    }
  });

  it("節が無ければ null", () => {
    expect(holdRequestText("Closes #3\n\n## 何を変えたか\n人間にお願いしたいことは特に…")).toBeNull();
    expect(pullRequestAsks("")).toEqual([]);
  });

  it("最後の節でも、次の見出しの手前までを読む", () => {
    expect(pullRequestAsks("## 人間にお願いしたいこと\n- a\n- b\n## 次\n- c")).toEqual(["a", "b"]);
    expect(pullRequestAsks("## 人間にお願いしたいこと\r\n- a\r\n- b")).toEqual(["a", "b"]);
  });
});

describe("trimTrailingPeriod", () => {
  it("末尾の。を取る", () => {
    expect(trimTrailingPeriod("足してください。")).toBe("足してください");
    expect(trimTrailingPeriod("足してください")).toBe("足してください");
  });
});
