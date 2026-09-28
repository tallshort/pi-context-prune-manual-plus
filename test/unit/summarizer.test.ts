import { describe, expect, it } from "vitest";
import { classifySummarizerFailure, summarizeBatch } from "../../src/summarizer.js";
import { DEFAULT_CONFIG, type CapturedBatch } from "../../src/types.js";

describe("summarizer failure classification", () => {
  it("marks rate-limit, network, and temporary provider failures as retryable", () => {
    expect(classifySummarizerFailure(new Error("429 rate limit exceeded"))).toMatchObject({ failureKind: "rate-limit", retryable: true });
    expect(classifySummarizerFailure(new Error("ECONNRESET while connecting"))).toMatchObject({ failureKind: "network", retryable: true });
    expect(classifySummarizerFailure(new Error("503 service unavailable"))).toMatchObject({ failureKind: "provider", retryable: true });
  });

  it("redacts bearer credentials before a failure can reach the overlay", () => {
    for (const message of [
      "Authorization: Bearer sk-secret",
      "authorization=Bearer token-value",
      "Bearer standalone-secret",
      "api_key: api-secret",
    ]) {
      const failure = classifySummarizerFailure(new Error(message));
      expect(failure.failureMessage).not.toMatch(/sk-secret|token-value|standalone-secret|api-secret/);
      expect(failure.failureMessage).toContain("[redacted]");
    }
  });
  it("does not retry permanent provider failures and returns a bounded safe message", () => {
    const failure = classifySummarizerFailure(new Error("invalid credentials\nstack details"));
    expect(failure).toEqual({ failureKind: "provider", failureMessage: "invalid credentials", retryable: false });
  });
});

const batch: CapturedBatch = {
  turnIndex: 0,
  timestamp: 0,
  assistantText: "",
  toolCalls: [{ toolCallId: "call-1", toolName: "read", args: {}, resultText: "raw", isError: false }],
};

const usage = {
  input: 10,
  output: 2,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 12,
  cost: { input: 0.01, output: 0.02, cacheRead: 0, cacheWrite: 0, total: 0.03 },
};

function contextFor(response: any, events: any[] = []) {
  const responseStream = {
    async *[Symbol.asyncIterator]() {
      for (const event of events) yield event;
    },
    result: async () => response,
  };
  return {
    model: { provider: "provider", id: "model" },
    modelRegistry: {
      getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "key" }),
      getProvider: () => ({ stream: () => responseStream }),
    },
    ui: { notify: () => undefined },
  } as any;
}

describe("summarizer usage callback", () => {
  it("reports a final response before converting stopReason error into a structured failure", async () => {
    const response = {
      role: "assistant",
      content: [],
      provider: "provider",
      model: "model",
      usage,
      stopReason: "error",
      errorMessage: "provider failed",
      timestamp: 1,
    };
    const reported: any[] = [];

    const result = await summarizeBatch(batch, DEFAULT_CONFIG, contextFor(response), {
      onUsage: (message) => reported.push(message),
      notifyOnFailure: false,
    });

    expect(result).toMatchObject({ failureKind: "provider" });
    expect(reported).toEqual([response]);
  });

  it("reports final usage even when cancellation fires during streaming", async () => {
    const controller = new AbortController();
    const response = {
      role: "assistant",
      content: [{ type: "text", text: "partial" }],
      provider: "provider",
      model: "model",
      usage,
      stopReason: "aborted",
      timestamp: 1,
    };
    const event = { type: "text_delta", partial: response };
    const reported: any[] = [];

    await expect(summarizeBatch(batch, DEFAULT_CONFIG, contextFor(response, [event]), {
      signal: controller.signal,
      onTextProgress: (receivedChars) => { if (receivedChars > 0) controller.abort(); },
      onUsage: (message) => reported.push(message),
    })).rejects.toThrow(/aborted/);

    expect(reported).toEqual([response]);
  });
});

describe("oversized streamed summaries", () => {
  it("aborts only this provider stream, reports partial usage, and returns a skip instead of a retryable failure", async () => {
    const partial = { ...contextFor({}).model, role: "assistant", content: [{ type: "text", text: "x".repeat(4) }] };
    const final = { ...partial, usage, stopReason: "aborted" };
    const stream = {
      async *[Symbol.asyncIterator]() {
        yield { type: "text_delta", partial };
        throw new Error("must not consume the next chunk");
      },
      result: async () => final,
    };
    let providerSignal: AbortSignal | undefined;
    const ctx = contextFor(final);
    ctx.modelRegistry.getProvider = () => ({ stream: (_model: unknown, _input: unknown, options: { signal: AbortSignal }) => {
      providerSignal = options.signal;
      return stream;
    } });
    const reported: any[] = [];
    const result = await summarizeBatch(batch, DEFAULT_CONFIG, ctx, { onUsage: (message) => reported.push(message) });
    expect(providerSignal?.aborted).toBe(true);
    expect(result).toEqual({ skippedOversized: true, summaryCharCount: 4 });
    expect(reported).toEqual([final]);
  });

  it("keeps streamed partial usage if the provider rejects result after size abort", async () => {
    const partial = { role: "assistant", content: [{ type: "text", text: "xxxx" }], usage };
    const ctx = contextFor({});
    ctx.modelRegistry.getProvider = () => ({ stream: () => ({
      async *[Symbol.asyncIterator]() { yield { type: "text_delta", partial }; },
      result: async () => { throw new Error("aborted"); },
    }) });
    const reported: any[] = [];
    expect(await summarizeBatch(batch, DEFAULT_CONFIG, ctx, { onUsage: (message) => reported.push(message) }))
      .toEqual({ skippedOversized: true, summaryCharCount: 4 });
    expect(reported).toEqual([partial]);
  });

  it("uses the last streamed partial usage when an oversized provider returns without usage", async () => {
    const partial = { role: "assistant", content: [{ type: "text", text: "xxxx" }], usage };
    const final = { role: "assistant", content: partial.content, stopReason: "aborted" };
    const ctx = contextFor(final, [{ type: "text_delta", partial }]);
    const reported: any[] = [];
    expect(await summarizeBatch(batch, DEFAULT_CONFIG, ctx, { onUsage: (message) => reported.push(message) }))
      .toEqual({ skippedOversized: true, summaryCharCount: 4 });
    expect(reported).toEqual([partial]);
  });

  it("does not abort a stream whose text fits the raw budget", async () => {
    const response = { role: "assistant", content: [{ type: "text", text: "ok" }], usage, stopReason: "stop" };
    const result = await summarizeBatch(batch, DEFAULT_CONFIG, contextFor(response, [{ type: "text_delta", partial: response }]));
    expect(result).toMatchObject({ summaryText: "ok" });
  });
});
