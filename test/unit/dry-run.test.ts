import { describe, expect, it } from "vitest";
import { calculateDryRunPreview } from "../../src/dry-run.js";
import type { CapturedBatch, SummarizerStats } from "../../src/types.js";

const batch = (id: string, resultText: string): CapturedBatch => ({
  turnIndex: 0,
  timestamp: 0,
  assistantText: "",
  toolCalls: [{ toolCallId: id, toolName: "read", args: {}, resultText, isError: false }],
});

const emptyStats: SummarizerStats = {
  totalInputTokens: 0, totalOutputTokens: 0, totalCost: 0, callCount: 0,
  totalPrunedRawChars: 0, totalPrunedSummaryChars: 0, retryCount: 0, finalFailureCount: 0,
  failureCounts: { "rate-limit": 0, network: 0, provider: 0, persistence: 0, cancelled: 0 },
};

describe("calculateDryRunPreview", () => {
  it("separates threshold-skipped batches without mutating the captured queue", () => {
    const batches = [batch("small", "12345"), batch("large", "123456")];
    const preview = calculateDryRunPreview(batches, 5, emptyStats);

    expect(preview).toEqual({
      batchCount: 2,
      toolCallCount: 2,
      rawCharCount: 11,
      candidateBatchCount: 1,
      candidateToolCallCount: 1,
      candidateRawCharCount: 6,
      skippedBatchCount: 1,
      skippedRawCharCount: 5,
      estimatedSummaryCharCount: undefined,
      estimatedSavingsCharCount: undefined,
    });
    expect(batches).toHaveLength(2);
  });

  it("estimates candidate savings from prior accepted summary compression", () => {
    const preview = calculateDryRunPreview([batch("large", "1234567890")], 0, {
      ...emptyStats,
      totalPrunedRawChars: 100,
      totalPrunedSummaryChars: 25,
    });

    expect(preview.estimatedSummaryCharCount).toBe(3);
    expect(preview.estimatedSavingsCharCount).toBe(7);
  });
});
