import { describe, expect, it } from "vitest";
import { ACTION_UNREACHABLE_MESSAGE, callAction } from "./actionCall";

type Result = { ok: true } | { ok: false; message: string };
const unreachable = (): Result => ({ ok: false, message: ACTION_UNREACHABLE_MESSAGE });

describe("callAction", () => {
  it("サーバーが返した結果は、成功も失敗もそのまま返す", async () => {
    expect(await callAction<Result>(async () => ({ ok: true }), unreachable)).toEqual({ ok: true });
    expect(
      await callAction<Result>(async () => ({ ok: false, message: "ログインし直してください" }), unreachable),
    ).toEqual({ ok: false, message: "ログインし直してください" });
  });

  it("呼び出しが投げたら（通信が切れた・古い画面のまま押した）、投げずに「届きませんでした」を返す", async () => {
    const result = await callAction<Result>(async () => {
      throw new TypeError("Failed to fetch");
    }, unreachable);
    expect(result).toEqual({ ok: false, message: ACTION_UNREACHABLE_MESSAGE });
  });

  it("呼ぶ前に同期で投げても同じ", async () => {
    const result = await callAction<Result>(() => {
      throw new Error("Failed to find Server Action");
    }, unreachable);
    expect(result).toEqual({ ok: false, message: ACTION_UNREACHABLE_MESSAGE });
  });

  it("うまくいったときは、届かなかったときの値を作らない", async () => {
    let made = 0;
    await callAction(async () => 1, () => {
      made++;
      return 0;
    });
    expect(made).toBe(0);
  });
});
