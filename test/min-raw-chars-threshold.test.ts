import { describe, expect, it } from "vitest";
import { shouldSkipMinRawCharsThreshold } from "../src/min-raw-chars-threshold.js";

describe("shouldSkipMinRawCharsThreshold", () => {
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
