import { mkdtempSync, readFileSync, statSync, truncateSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { MAX_USAGE_LOG_BYTES, appendUsageLog, normalizeUsage } from "../../src/usage-log.js";
import { createSummarizerUsageReporter, reportSummarizerUsage } from "../../src/usage-report.js";
import { StatsAccumulator } from "../../src/stats.js";
import type { CapturedBatch } from "../../src/types.js";

const usage = {
  input: 12,
  output: 3,
  cacheRead: 4,
  cacheWrite: 5,
  totalTokens: 24,
  cost: { input: 0.01, output: 0.02, cacheRead: 0.03, cacheWrite: 0.04, total: 0.1 },
};

const batch: CapturedBatch = {
  turnIndex: 7,
  timestamp: 1,
  assistantText: "",
  toolCalls: [{ toolCallId: "call-1", toolName: "read", args: {}, resultText: "raw", isError: false }],
};

const response = {
  role: "assistant",
  content: [{ type: "text", text: "summary" }],
  provider: "provider",
  model: "requested-model",
  responseModel: "actual-model",
  usage,
  stopReason: "stop",
  timestamp: 1,
} as any;

describe("summarizer usage reporting", () => {
  it("writes a Pi usage entry and a content-free sidecar record with the shared identity", () => {
    const writeLog = vi.fn();
    const appendUsage = vi.fn(() => ({ id: "usage-1", timestamp: "2026-01-02T03:04:05.000Z" }));

    reportSummarizerUsage(
      { getSessionId: () => "session-1", appendUsage } as any,
      response,
      batch,
      vi.fn(),
      writeLog,
    );

    expect(appendUsage).toHaveBeenCalledWith(
      "context_prune",
      "provider",
      "actual-model",
      usage,
      "summarizer call: 1 tool call (turn 7)",
    );
    expect(writeLog).toHaveBeenCalledWith(expect.objectContaining({
      v: 1,
      id: "session-1:usage-1",
      ts: "2026-01-02T03:04:05.000Z",
      source: "context-prune",
      label: "summarizer",
      provider: "provider",
      model: "actual-model",
      sessionId: "session-1",
      usageEntryId: "usage-1",
      kind: "context_prune",
      usage: { input: 12, output: 3, cacheRead: 4, cacheWrite: 5, reasoning: 0, cost: 0.1 },
    }));
    expect(JSON.stringify(writeLog.mock.calls[0][0])).not.toContain("summary");
    expect(JSON.stringify(writeLog.mock.calls[0][0])).not.toContain("raw");
  });

  it("adds a provider response to pruner stats exactly once even if the same response is delivered twice", () => {
    const stats = new StatsAccumulator();
    const appendUsage = vi.fn(() => ({ id: "usage-1", timestamp: "2026-01-02T03:04:05.000Z" }));
    const reporter = createSummarizerUsageReporter({
      session: { getSessionId: () => "session-1", appendUsage } as any,
      addUsage: (reportedUsage) => stats.add(reportedUsage as any),
      notifyError: vi.fn(),
      writeLog: vi.fn(),
    });

    reporter(batch, response);
    reporter(batch, response);

    expect(stats.getStats()).toMatchObject({
      callCount: 1,
      totalInputTokens: 12,
      totalOutputTokens: 3,
      totalCost: 0.1,
    });
    expect(appendUsage).toHaveBeenCalledTimes(1);
  });

  it("counts distinct retry responses as distinct paid calls", () => {
    const stats = new StatsAccumulator();
    const reporter = createSummarizerUsageReporter({
      session: { getSessionId: () => "session-1" },
      addUsage: (reportedUsage) => stats.add(reportedUsage as any),
      notifyError: vi.fn(),
      writeLog: vi.fn(),
    });

    reporter(batch, response);
    reporter(batch, { ...response });

    expect(stats.getStats().callCount).toBe(2);
  });

  it("falls back to a generated sidecar id and isolates Pi and disk failures", () => {
    const records: any[] = [];
    const errors: unknown[] = [];
    reportSummarizerUsage(
      { getSessionId: () => "session-2" },
      response,
      batch,
      (error) => errors.push(error),
      (record) => records.push(record),
    );
    expect(records[0].id).toMatch(/^[0-9a-f-]{36}$/);
    expect(records[0]).not.toHaveProperty("usageEntryId");

    expect(() => reportSummarizerUsage(
      { getSessionId: () => "session-2", appendUsage: () => { throw new Error("session failed"); } } as any,
      response,
      batch,
      (error) => errors.push(error),
      () => { throw new Error("disk failed"); },
    )).not.toThrow();
    expect(errors).toHaveLength(2);
    expect(() => reportSummarizerUsage(
      { getSessionId: () => "session-2", appendUsage: () => { throw new Error("session failed"); } } as any,
      response,
      batch,
      () => { throw new Error("notification failed"); },
      () => { throw new Error("disk failed"); },
    )).not.toThrow();
  });
});

describe("pi-stats usage sidecar", () => {
  it("normalizes invalid fields and rotates at the size limit", () => {
    expect(normalizeUsage({
      ...usage,
      input: Number.NaN,
      output: -1,
      cost: { ...usage.cost, total: Number.POSITIVE_INFINITY },
    } as any)).toEqual({ input: 0, output: 0, cacheRead: 4, cacheWrite: 5, reasoning: 0, cost: 0 });

    const directory = mkdtempSync(join(tmpdir(), "context-prune-usage-"));
    appendUsageLog({
      v: 1,
      id: "first",
      ts: "2026-01-02T03:04:05.000Z",
      source: "context-prune",
      label: "summarizer",
      provider: "provider",
      model: "model",
      usage: normalizeUsage(usage as any),
      sessionId: "session",
      kind: "context_prune",
    }, directory);
    truncateSync(join(directory, "usage.jsonl"), MAX_USAGE_LOG_BYTES);
    appendUsageLog({
      v: 1,
      id: "second",
      ts: "2026-01-02T03:04:06.000Z",
      source: "context-prune",
      label: "summarizer",
      provider: "provider",
      model: "model",
      usage: normalizeUsage(usage as any),
      sessionId: "session",
      kind: "context_prune",
    }, directory);

    expect(statSync(join(directory, "usage.jsonl.1")).size).toBe(MAX_USAGE_LOG_BYTES);
    expect(readFileSync(join(directory, "usage.jsonl"), "utf8")).toContain('"id":"second"');
  });
});
