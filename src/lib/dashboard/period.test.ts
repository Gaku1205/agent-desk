import { describe, expect, it } from "vitest";
import { parsePeriodParam } from "./period";

describe("parsePeriodParam", () => {
  it("決まった期間だけ通す", () => {
    expect(parsePeriodParam("24h")).toBe("24h");
    expect(parsePeriodParam("7d")).toBe("7d");
    expect(parsePeriodParam("30d")).toBe("30d");
  });
  it("無い値・分からない値は undefined", () => {
    expect(parsePeriodParam(undefined)).toBeUndefined();
    expect(parsePeriodParam("90d")).toBeUndefined();
    expect(parsePeriodParam("")).toBeUndefined();
  });
  it("複数あれば最初の1つ", () => {
    expect(parsePeriodParam(["7d", "30d"])).toBe("7d");
  });
});
