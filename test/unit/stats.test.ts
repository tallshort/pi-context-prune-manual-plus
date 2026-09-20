import { describe, expect, it } from "vitest";
import { StatsAccumulator } from "../../src/stats.js";

describe("StatsAccumulator retry and failure totals", () => {
  it("accumulates retries and terminal failures by safe failure kind", () => {
    const stats = new StatsAccumulator();
    stats.addRetry();
    stats.addRetry();
    stats.addFinalFailure("network");
    stats.addFinalFailure("provider");
    stats.addFinalFailure("network");

    expect(stats.getStats()).toMatchObject({
      retryCount: 2,
      finalFailureCount: 3,
      failureCounts: { "rate-limit": 0, network: 2, provider: 1, persistence: 0, cancelled: 0 },
    });
  });
});
