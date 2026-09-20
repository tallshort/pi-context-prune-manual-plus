import { describe, expect, it } from "vitest";
import { DEFAULT_MANUAL_PRUNE_CONCURRENCY, normalizeManualPruneConcurrency } from "../../src/config.js";

describe("manual prune concurrency configuration", () => {
  it("accepts whole values in the safe 1–16 range", () => {
    expect(normalizeManualPruneConcurrency(1)).toBe(1);
    expect(normalizeManualPruneConcurrency(16)).toBe(16);
    expect(normalizeManualPruneConcurrency(3.9)).toBe(3);
  });

  it("falls back to the default for invalid or out-of-range values", () => {
    expect(normalizeManualPruneConcurrency(0)).toBe(DEFAULT_MANUAL_PRUNE_CONCURRENCY);
    expect(normalizeManualPruneConcurrency(17)).toBe(DEFAULT_MANUAL_PRUNE_CONCURRENCY);
    expect(normalizeManualPruneConcurrency("8")).toBe(DEFAULT_MANUAL_PRUNE_CONCURRENCY);
  });
});
