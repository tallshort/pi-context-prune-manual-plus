import { describe, expect, it } from "vitest";
import { classifySummarizerFailure } from "../../src/summarizer.js";

describe("summarizer failure classification", () => {
  it("marks rate-limit, network, and temporary provider failures as retryable", () => {
    expect(classifySummarizerFailure(new Error("429 rate limit exceeded"))).toMatchObject({ failureKind: "rate-limit", retryable: true });
    expect(classifySummarizerFailure(new Error("ECONNRESET while connecting"))).toMatchObject({ failureKind: "network", retryable: true });
    expect(classifySummarizerFailure(new Error("503 service unavailable"))).toMatchObject({ failureKind: "provider", retryable: true });
  });

  it("does not retry permanent provider failures and returns a bounded safe message", () => {
    const failure = classifySummarizerFailure(new Error("invalid credentials\nstack details"));
    expect(failure).toEqual({ failureKind: "provider", failureMessage: "invalid credentials", retryable: false });
  });
});
