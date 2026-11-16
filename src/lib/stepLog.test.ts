import { describe, expect, it } from "vitest";
import { formatDuration, isStepLogComment, parseStepLog } from "./stepLog";

const NOW = new Date("2026-11-15T08:00:00Z");

const line = (json: object | string) =>
  `<!-- ai-step ${typeof json === "string" ? json : JSON.stringify(json)} -->`;

const row = (overrides: Record<string, unknown>) => ({
  step: "implement",
  model: "opus",
  started: "2026-11-15T07:28:00Z",
  finished: "2026-11-15T07:31:12Z",
  result: "success",
  ...overrides,
});

describe("formatDuration", () => {
  it("短い日本語にする", () => {
    expect(formatDuration(45_000)).toBe("45秒");
    expect(formatDuration(192_000)).toBe("3分12秒");
    expect(formatDuration(180_000)).toBe("3分");
    expect(formatDuration(3_900_000)).toBe("1時間5分");
    expect(formatDuration(0)).toBe("0秒");
  });
  it("負の値は null", () => {
    expect(formatDuration(-1)).toBeNull();
    expect(formatDuration(Number.NaN)).toBeNull();
  });
});

describe("isStepLogComment", () => {
  it("先頭の行が目印のコメントだけ", () => {
    expect(isStepLogComment("<!-- ai-step-log -->\n| 工程 |")).toBe(true);
    expect(isStepLogComment("本文\n<!-- ai-step-log -->")).toBe(false);
  });
});

describe("parseStepLog", () => {
  it("正常な行を読む（mocks はデザイン）", () => {
    const body = [
      "<!-- ai-step-log -->",
      "| 工程 | モデル |",
      line(row({ step: "mocks", model: "sonnet" })),
      line(row({})),
    ].join("\n");
    expect(parseStepLog(body, NOW)).toEqual([
      { key: "design", model: "sonnet", duration: "3分12秒", started: "16:28" },
      { key: "implement", model: "opus", duration: "3分12秒", started: "16:28" },
    ]);
  });

  it("model が null の工程は model を null で返す", () => {
    const body = line(row({ step: "ci", model: null, finished: "2026-11-15T07:28:45Z" }));
    expect(parseStepLog(body, NOW)).toEqual([{ key: "ci", model: null, duration: "45秒", started: "16:28" }]);
  });

  it("進行中（finished が null）は now までの経過時間", () => {
    const body = line(row({ step: "fix", finished: null, result: "running", attempt: 1, max_attempts: 3 }));
    expect(parseStepLog(body, NOW)).toEqual([{ key: "fix", model: "opus", duration: "32分", started: "16:28" }]);
  });

  it("壊れた JSON・知らない step・欠けた項目は読み飛ばす", () => {
    const body = [
      line("{broken"),
      line(row({ step: "unknown" })),
      line(row({ result: "done" })),
      line(row({ started: "いつか" })),
      line(row({ finished: "いつか" })),
      line(JSON.stringify({ step: "plan", model: "opus", started: "2026-11-15T07:28:00Z", result: "success" })),
      line("[1,2]"),
      line(row({ step: "review", model: 3 })),
      line(row({ step: "deploy", model: null })),
    ].join("\n");
    expect(parseStepLog(body, NOW)).toEqual([{ key: "deploy", model: null, duration: "3分12秒", started: "16:28" }]);
  });

  it("同じ工程が複数あれば最後の行を使う", () => {
    const body = [line(row({ model: "sonnet" })), line(row({ model: "opus" }))].join("\n");
    expect(parseStepLog(body, NOW)).toEqual([{ key: "implement", model: "opus", duration: "3分12秒", started: "16:28" }]);
  });

  it("行が無ければ空", () => {
    expect(parseStepLog("<!-- ai-step-log -->", NOW)).toEqual([]);
  });
});
