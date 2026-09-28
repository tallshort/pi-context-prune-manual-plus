import { describe, expect, it, vi } from "vitest";
import { SkippedOversizedTracker } from "../../src/skipped-oversized.js";
import { CUSTOM_TYPE_SKIPPED_OVERSIZED, type CapturedBatch } from "../../src/types.js";

const batch: CapturedBatch = {
  turnIndex: 2, timestamp: 1, assistantText: "",
  toolCalls: [{ toolCallId: "call-2", toolName: "read", args: {}, resultText: "raw", isError: false }],
};

describe("out-of-order oversized skips", () => {
  it("persists before excluding and rebuilds only from the active branch", () => {
    const tracker = new SkippedOversizedTracker();
    expect(() => tracker.mark(batch, () => { throw new Error("write failed"); })).toThrow("write failed");
    expect(tracker.isSkipped("call-2")).toBe(false);

    const append = vi.fn();
    tracker.mark(batch, append);
    tracker.mark(batch, append);
    expect(append).toHaveBeenCalledOnce();
    expect(append).toHaveBeenCalledWith(CUSTOM_TYPE_SKIPPED_OVERSIZED, { toolCallIds: ["call-2"] });

    const reopened = new SkippedOversizedTracker();
    reopened.reconstructFromSession({ sessionManager: { getBranch: () => [
      { type: "custom", customType: CUSTOM_TYPE_SKIPPED_OVERSIZED, data: { toolCallIds: ["call-2"] } },
    ] } } as any);
    expect(reopened.isSkipped("call-2")).toBe(true);
    reopened.reconstructFromSession({ sessionManager: { getBranch: () => [] } } as any);
    expect(reopened.isSkipped("call-2")).toBe(false);
  });
});
