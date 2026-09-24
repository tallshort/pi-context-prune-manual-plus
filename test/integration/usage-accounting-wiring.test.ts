import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CapturedBatch } from "../../src/types.js";
import { CUSTOM_TYPE_STATS } from "../../src/types.js";

const harness = vi.hoisted(() => ({
  agentDir: "",
  flush: undefined as undefined | ((ctx: any, options?: any) => Promise<any>),
}));

vi.mock("@earendil-works/pi-coding-agent", () => ({
  getAgentDir: () => harness.agentDir,
}));

vi.mock("../../src/commands.js", () => ({
  registerCommands: vi.fn(),
  pruneStatusText: vi.fn(() => "prune"),
  setPruneStatusWidget: vi.fn(),
}));

vi.mock("../../src/context-prune-tool.js", () => ({
  registerContextPruneTool: vi.fn((_pi: unknown, flush: typeof harness.flush) => {
    harness.flush = flush;
  }),
}));

vi.mock("../../src/query-tool.js", () => ({ registerQueryTool: vi.fn() }));

import registerExtension from "../../index.js";

const usage = {
  input: 12,
  output: 3,
  cacheRead: 4,
  cacheWrite: 5,
  totalTokens: 24,
  cost: { input: 0.01, output: 0.02, cacheRead: 0.03, cacheWrite: 0.04, total: 0.1 },
};

function batch(rawChars: number, toolCallId = "call-1", turnIndex = 7): CapturedBatch {
  return {
    turnIndex,
    timestamp: 1,
    assistantText: "",
    toolCalls: [{
      toolCallId,
      toolName: "read",
      args: {},
      resultText: "x".repeat(rawChars),
      isError: false,
    }],
  };
}

function response(summary: string, overrides: Record<string, unknown> = {}) {
  return {
    role: "assistant",
    content: [{ type: "text", text: summary }],
    provider: "provider",
    model: "requested-model",
    responseModel: "actual-model",
    usage,
    stopReason: "stop",
    timestamp: 1,
    ...overrides,
  };
}

type FinalResponse = ReturnType<typeof response>;

function setup(
  responses: FinalResponse | FinalResponse[],
  appendUsage: ReturnType<typeof vi.fn>,
  options: { sendMessage?: () => void } = {},
) {
  const entries: Array<{ customType: string; data: any }> = [];
  const responseQueue = Array.isArray(responses) ? [...responses] : [responses];
  const fallbackResponse = responseQueue[responseQueue.length - 1];
  const pi = {
    on: vi.fn(),
    appendEntry: vi.fn((customType: string, data: any) => {
      entries.push({ customType, data });
      return `entry-${entries.length}`;
    }),
    sendMessage: vi.fn(options.sendMessage),
    getActiveTools: vi.fn(() => []),
    setActiveTools: vi.fn(),
  } as any;
  registerExtension(pi);

  const ctx = {
    model: { provider: "provider", id: "requested-model" },
    modelRegistry: {
      getApiKeyAndHeaders: vi.fn(async () => ({ ok: true, apiKey: "key" })),
      getProvider: vi.fn(() => ({
        stream: () => {
          const finalResponse = responseQueue.shift() ?? fallbackResponse;
          return {
            async *[Symbol.asyncIterator]() {},
            result: async () => finalResponse,
          };
        },
      })),
    },
    sessionManager: {
      getSessionId: () => "session-1",
      appendUsage,
    },
    ui: { notify: vi.fn(), setStatus: vi.fn() },
  } as any;

  return { ctx, entries };
}

function latestStats(entries: Array<{ customType: string; data: any }>) {
  return entries.filter((entry) => entry.customType === CUSTOM_TYPE_STATS).at(-1)?.data;
}

describe("flush usage accounting", () => {
  beforeEach(() => {
    harness.flush = undefined;
    harness.agentDir = mkdtempSync(join(tmpdir(), "context-prune-agent-"));
  });

  it("records one Pi entry, one sidecar row, and one pruner-stats call for a successful flush", async () => {
    const appendUsage = vi.fn(() => ({ id: "usage-1", timestamp: "2026-01-02T03:04:05.000Z" }));
    const { ctx, entries } = setup(response("short summary"), appendUsage);

    const result = await harness.flush!(ctx, { previewedBatches: [batch(5_000)] });

    expect(result).toMatchObject({ ok: true, reason: "flushed" });
    expect(appendUsage).toHaveBeenCalledTimes(1);
    expect(latestStats(entries)).toMatchObject({
      callCount: 1,
      totalInputTokens: 12,
      totalOutputTokens: 3,
      totalCost: 0.1,
    });
    const sidecar = readFileSync(join(harness.agentDir, "context-prune", "usage.jsonl"), "utf8")
      .trim()
      .split("\n");
    expect(sidecar).toHaveLength(1);
    expect(JSON.parse(sidecar[0])).toMatchObject({ id: "session-1:usage-1", usageEntryId: "usage-1" });
  });

  it("keeps an oversized flush successful when both Pi and sidecar usage reporting fail", async () => {
    const blockedPath = join(harness.agentDir, "blocked");
    writeFileSync(blockedPath, "not a directory");
    harness.agentDir = blockedPath;
    const appendUsage = vi.fn(() => { throw new Error("session usage failed"); });
    const { ctx, entries } = setup(response("s".repeat(2_000)), appendUsage);

    const result = await harness.flush!(ctx, { previewedBatches: [batch(700)] });

    expect(result).toMatchObject({ ok: true, reason: "skipped-oversized" });
    expect(appendUsage).toHaveBeenCalledTimes(1);
    expect(latestStats(entries)).toMatchObject({ callCount: 1, totalCost: 0.1 });
    const usageWarnings = ctx.ui.notify.mock.calls.filter(([message]: [string]) =>
      message.includes("could not record summarizer usage"),
    );
    expect(usageWarnings).toEqual([[
      expect.stringContaining("could not record summarizer usage"),
      "warning",
    ]]);
  });

  it("does not fail the flush when session-id lookup for usage reporting throws", async () => {
    const appendUsage = vi.fn();
    const { ctx, entries } = setup(response("short summary"), appendUsage);
    ctx.sessionManager.getSessionId = () => { throw new Error("session id unavailable"); };

    const result = await harness.flush!(ctx, { previewedBatches: [batch(5_000)] });

    expect(result).toMatchObject({ ok: true, reason: "flushed" });
    expect(appendUsage).not.toHaveBeenCalled();
    expect(latestStats(entries)).toMatchObject({ callCount: 1, totalCost: 0.1 });
    const sidecar = readFileSync(join(harness.agentDir, "context-prune", "usage.jsonl"), "utf8");
    expect(JSON.parse(sidecar)).toMatchObject({ sessionId: "" });
  });

  it("accounts both provider responses when a manual flush retries once", async () => {
    let usageEntry = 0;
    const appendUsage = vi.fn(() => ({ id: `usage-${++usageEntry}`, timestamp: "2026-01-02T03:04:05.000Z" }));
    const { ctx, entries } = setup([
      response("", { stopReason: "error", errorMessage: "503 service unavailable" }),
      response("short summary"),
    ], appendUsage);

    const result = await harness.flush!(ctx, {
      previewedBatches: [batch(5_000)],
      onProgress: vi.fn(),
    });

    expect(result).toMatchObject({ ok: true, reason: "flushed" });
    expect(appendUsage).toHaveBeenCalledTimes(2);
    expect(latestStats(entries)).toMatchObject({ callCount: 2, retryCount: 1, totalCost: 0.2 });
  });

  it("waits for parallel responses and persists their usage when the first batch fails", async () => {
    let usageEntry = 0;
    const appendUsage = vi.fn(() => ({ id: `usage-${++usageEntry}`, timestamp: "2026-01-02T03:04:05.000Z" }));
    const { ctx, entries } = setup([
      response("", { stopReason: "error", errorMessage: "invalid request" }),
      response("short summary"),
    ], appendUsage);

    const result = await harness.flush!(ctx, {
      previewedBatches: [batch(5_000, "call-1", 7), batch(5_000, "call-2", 8)],
    });

    expect(result).toMatchObject({ ok: false, reason: "summarizer-failed" });
    expect(appendUsage).toHaveBeenCalledTimes(2);
    expect(latestStats(entries)).toMatchObject({ callCount: 2, finalFailureCount: 1, totalCost: 0.2 });
  });

  it("persists usage when summary persistence fails after the provider response", async () => {
    const appendUsage = vi.fn(() => ({ id: "usage-1", timestamp: "2026-01-02T03:04:05.000Z" }));
    const { ctx, entries } = setup(response("short summary"), appendUsage, {
      sendMessage: () => { throw new Error("This extension ctx is stale"); },
    });

    const result = await harness.flush!(ctx, { previewedBatches: [batch(5_000)] });

    expect(result).toMatchObject({ ok: false, reason: "summarizer-failed" });
    expect(appendUsage).toHaveBeenCalledTimes(1);
    expect(latestStats(entries)).toMatchObject({ callCount: 1, totalCost: 0.1 });
  });

  it("retains usage from an already-started batch after soft cancellation", async () => {
    const controller = new AbortController();
    const appendUsage = vi.fn(() => ({ id: "usage-1", timestamp: "2026-01-02T03:04:05.000Z" }));
    const { ctx, entries } = setup(response("short summary"), appendUsage);

    const result = await harness.flush!(ctx, {
      previewedBatches: [batch(5_000)],
      signal: controller.signal,
      onProgress: (_index: number, _total: number, _batch: CapturedBatch, stage: string) => {
        if (stage === "start") controller.abort();
      },
    });

    expect(result).toMatchObject({ ok: true, reason: "cancelled" });
    expect(appendUsage).toHaveBeenCalledTimes(1);
    expect(latestStats(entries)).toMatchObject({ callCount: 1, totalCost: 0.1 });
  });
});
