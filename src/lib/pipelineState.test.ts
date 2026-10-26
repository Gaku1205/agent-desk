import { describe, expect, it } from "vitest";
import { judgePipelineState } from "./pipelineState";

describe("judgePipelineState", () => {
  it("ワークフローがあり、実行が1度でもあれば動いている", () => {
    expect(judgePipelineState({ workflowExists: true, runCount: 3 })).toBe("running");
  });

  it("ワークフローが無ければ動いていない", () => {
    expect(judgePipelineState({ workflowExists: false, runCount: 0 })).toBe("notConfigured");
  });

  it("ワークフローがあっても実行が1度も無ければ動いていない", () => {
    expect(judgePipelineState({ workflowExists: true, runCount: 0 })).toBe("notConfigured");
  });

  it("調べられなければ分からない", () => {
    expect(judgePipelineState(null)).toBe("unknown");
  });
});
