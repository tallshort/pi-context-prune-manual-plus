import { describe, expect, it } from "vitest";
import { PruneFrontierTracker } from "../../src/frontier.js";
import { ToolCallIndexer } from "../../src/indexer.js";
import { pruneMessages } from "../../src/pruner.js";
import { hydrateSessionState } from "../../src/session-hydration.js";
import { StatsAccumulator } from "../../src/stats.js";
import { CUSTOM_TYPE_FRONTIER, CUSTOM_TYPE_INDEX, CUSTOM_TYPE_STATS } from "../../src/types.js";

describe("session hydration", () => {
  it("reconstructs persisted pruning state before context filtering", () => {
    const indexer = new ToolCallIndexer();
    const stats = new StatsAccumulator();
    const frontier = new PruneFrontierTracker();
    const ctx = {
      sessionManager: {
        getBranch: () => [
          { type: "custom", customType: CUSTOM_TYPE_INDEX, data: { toolCalls: [{ toolCallId: "persisted", toolName: "read", args: {}, resultText: "saved", isError: false, turnIndex: 2, timestamp: 10 }] } },
          { type: "custom", customType: CUSTOM_TYPE_STATS, data: { totalInputTokens: 5, totalOutputTokens: 3, totalCost: 0, totalPrunedRawChars: 10, totalPrunedSummaryChars: 4, callCount: 1, retryCount: 0, finalFailureCount: 0, failureCounts: { "rate-limit": 0, network: 0, provider: 0, persistence: 0, cancelled: 0 } } },
          { type: "custom", customType: CUSTOM_TYPE_FRONTIER, data: { lastAttemptedToolCallId: "persisted", lastAttemptedToolName: "read", lastAttemptedTurnIndex: 2, lastAttemptedTimestamp: 10, attemptedBatchCount: 1, attemptedToolCallCount: 1, rawCharCount: 10, summaryCharCount: 4, outcome: "summarized" } },
        ],
      },
    } as any;

    hydrateSessionState(ctx, indexer, stats, frontier);

    expect(pruneMessages([{ role: "toolResult", toolCallId: "persisted", content: [{ type: "text", text: "saved" }] }], indexer)).toEqual([]);
    expect(stats.getStats().callCount).toBe(1);
    expect(frontier.get()?.lastAttemptedToolCallId).toBe("persisted");
  });
});
