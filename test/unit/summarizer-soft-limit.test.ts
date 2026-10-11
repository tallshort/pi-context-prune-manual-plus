import { describe, expect, it } from "vitest";
import { summarizeBatch } from "../../src/summarizer.js";
import { DEFAULT_CONFIG, type CapturedBatch } from "../../src/types.js";

function batchOf(rawChars: number): CapturedBatch {
  return {
    turnIndex: 0,
    timestamp: 0,
    assistantText: "",
    toolCalls: [{ toolCallId: "call-1", toolName: "read", args: {}, resultText: "r".repeat(rawChars), isError: false }],
  };
}

function contextFor(outputs: Array<{ text: string; throwsOnResult?: boolean }>) {
  const signals: AbortSignal[] = [];
  const prompts: string[] = [];
  let calls = 0;
  const ctx = {
    model: { provider: "provider", id: "model" },
    modelRegistry: {
      getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "key" }),
      getProvider: () => ({
        stream: (_model: unknown, input: any, options: { signal: AbortSignal }) => {
          const output = outputs[calls++];
          if (!output) throw new Error("unexpected extra provider call");
          signals.push(options.signal);
          prompts.push(input.messages[0].content[0].text);
          const partial = { role: "assistant", content: [{ type: "text", text: output.text }] };
          return {
            async *[Symbol.asyncIterator]() { yield { type: "text_delta", partial }; },
            result: async () => {
              if (output.throwsOnResult) throw new Error("stream stopped by size signal");
              return { ...partial, stopReason: "stop", usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
            },
          };
        },
      }),
    },
    ui: { notify: () => undefined },
  } as any;
  return { ctx, signals, prompts, get calls() { return calls; } };
}

describe("large-result soft summary budget", () => {
  it("stops a 4k runaway, retries once with a stronger prompt, then accepts a compact summary", async () => {
    const run = contextFor([{ text: "x".repeat(4_100), throwsOnResult: true }, { text: "useful summary" }]);
    let retries = 0;
    const result = await summarizeBatch(batchOf(40_373), DEFAULT_CONFIG, run.ctx, { onSoftRetry: () => { retries++; } });
    expect(result).toMatchObject({ summaryText: "useful summary" });
    expect(run.calls).toBe(2);
    expect(run.signals[0].aborted).toBe(true);
    expect(run.prompts[1]).toContain("Do not reproduce raw logs");
    expect(retries).toBe(1);
  });

  it("accepts a second summary over 4k when it remains shorter than the original", async () => {
    const run = contextFor([{ text: "x".repeat(4_100), throwsOnResult: true }, { text: "y".repeat(4_100) }]);
    const result = await summarizeBatch(batchOf(40_373), DEFAULT_CONFIG, run.ctx);
    expect("summaryText" in result ? result.summaryText.length : -1).toBe(4_100);
    expect(run.signals[0].aborted).toBe(true);
    expect(run.signals[1].aborted).toBe(false);
    expect(run.calls).toBe(2);
  });

  it("still records an oversized skip immediately if the first stream exceeds the raw result", async () => {
    const run = contextFor([{ text: "x".repeat(4_100), throwsOnResult: true }]);
    let retries = 0;
    const result = await summarizeBatch(batchOf(3_000), DEFAULT_CONFIG, run.ctx, { onSoftRetry: () => { retries++; } });
    expect(result).toEqual({ skippedOversized: true, summaryCharCount: 4_100 });
    expect(retries).toBe(0);
    expect(run.calls).toBe(1);
  });

  it("records a hard skip on retry only when that retry actually exceeds the original length", async () => {
    const run = contextFor([{ text: "x".repeat(4_100), throwsOnResult: true }, { text: "y".repeat(40_374), throwsOnResult: true }]);
    const result = await summarizeBatch(batchOf(40_373), DEFAULT_CONFIG, run.ctx);
    expect(result).toEqual({ skippedOversized: true, summaryCharCount: 40_374 });
    expect(run.calls).toBe(2);
  });
});
