import { describe, expect, it } from "vitest";
import { shouldSkipMinRawCharsThreshold } from "../../src/min-raw-chars-threshold.js";
import { DEFAULT_CONFIG, DEFAULT_MIN_RAW_CHARS_THRESHOLD } from "../../src/types.js";

describe("shouldSkipMinRawCharsThreshold", () => {
  it("defaults to skipping batches at or below 600 raw characters", () => {
    expect(DEFAULT_MIN_RAW_CHARS_THRESHOLD).toBe(600);
    expect(DEFAULT_CONFIG.minRawCharsThreshold).toBe(DEFAULT_MIN_RAW_CHARS_THRESHOLD);
    expect(shouldSkipMinRawCharsThreshold(600, DEFAULT_MIN_RAW_CHARS_THRESHOLD)).toBe(true);
    expect(shouldSkipMinRawCharsThreshold(601, DEFAULT_MIN_RAW_CHARS_THRESHOLD)).toBe(false);
  });

  it("does not skip when the threshold is 0", () => {
    expect(shouldSkipMinRawCharsThreshold(0, 0)).toBe(false);
  });

  it("skips when raw characters equal the threshold", () => {
    expect(shouldSkipMinRawCharsThreshold(100, 100)).toBe(true);
  });

  it("does not skip when raw characters exceed the threshold", () => {
    expect(shouldSkipMinRawCharsThreshold(101, 100)).toBe(false);
  });
});
