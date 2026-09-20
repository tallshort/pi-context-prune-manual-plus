import { describe, expect, it } from "vitest";
import { DeferredSummaryCache } from "../../src/deferred-summary-cache.js";
import type { CapturedBatch } from "../../src/types.js";

const batch = (...ids: string[]) => ({
  toolCalls: ids.map((toolCallId) => ({ toolCallId })),
}) as CapturedBatch;

describe("DeferredSummaryCache", () => {
  it("reuses only an identical ordered tool-call batch", () => {
    const cache = new DeferredSummaryCache<string>();
    const original = batch("call-a", "call-b");
    cache.set(original, "summary");

    expect(cache.get(batch("call-a", "call-b"))).toBe("summary");
    expect(cache.get(batch("call-b", "call-a"))).toBeUndefined();
    expect(cache.get(batch("call-a"))).toBeUndefined();
  });

  it("removes entries when consumed or when session state is reset", () => {
    const cache = new DeferredSummaryCache<string>();
    const first = batch("call-a");
    const second = batch("call-b");
    cache.set(first, "first");
    cache.set(second, "second");

    cache.delete(first);
    expect(cache.get(first)).toBeUndefined();
    expect(cache.get(second)).toBe("second");

    cache.clear();
    expect(cache.get(second)).toBeUndefined();
  });
});
