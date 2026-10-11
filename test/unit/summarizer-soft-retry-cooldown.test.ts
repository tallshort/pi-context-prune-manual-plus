import { describe, expect, it, vi } from "vitest";
import { summarizeBatch } from "../../src/summarizer.js";
import { DEFAULT_CONFIG, type CapturedBatch } from "../../src/types.js";

const gate = vi.hoisted(() => ({ remainingMs: 0 }));
vi.mock("../../src/provider-rate-limit-gate.js", () => ({
  ProviderRateLimitGate: class {
    remainingMs() { return gate.remainingMs; }
    recordSuccess() {}
    recordRateLimit() { gate.remainingMs = 5_000; }
  },
}));

describe("concise retry during provider cooldown", () => {
  it("does not start or count a retry when another request activates cooldown", async () => {
    gate.remainingMs = 0;
    const batch: CapturedBatch = {
      turnIndex: 1, timestamp: 1, assistantText: "",
      toolCalls: [{ toolCallId: "call-1", toolName: "read", args: {}, resultText: "r".repeat(8_000), isError: false }],
    };
    const onSoftRetry = vi.fn();
    const onUsage = vi.fn();
    const stream = vi.fn(() => ({
      async *[Symbol.asyncIterator]() {
        yield { type: "text_delta", partial: { role: "assistant", content: [{ type: "text", text: "x".repeat(4_100) }] } };
      },
      result: async () => {
        gate.remainingMs = 5_000;
        throw new Error("stream stopped after local size abort");
      },
    }));
    const ctx = {
      model: { provider: "provider", id: "model" },
      modelRegistry: {
        getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "key" }),
        getProvider: () => ({ stream }),
      },
      ui: { notify: vi.fn() },
    } as any;

    const result = await summarizeBatch(batch, DEFAULT_CONFIG, ctx, { onSoftRetry, onUsage });

    expect(result).toMatchObject({ failureKind: "rate-limit", retryable: false });
    expect(stream).toHaveBeenCalledTimes(1);
    expect(onSoftRetry).not.toHaveBeenCalled();
    expect(onUsage).not.toHaveBeenCalled();
  });
});
