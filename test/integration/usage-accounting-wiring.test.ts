import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CapturedBatch } from "../../src/types.js";
import { CUSTOM_TYPE_FRONTIER, CUSTOM_TYPE_STATS } from "../../src/types.js";
import { formatSummaryToolCallRefs, wrapSummaryForContext } from "../../src/summary-refs.js";

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
  options: { sendMessage?: () => void; resultGate?: Promise<void>; streamed?: boolean; rejectResultWhenAborted?: boolean; streamedPartialUsage?: boolean } = {},
) {
  const entries: Array<{ customType: string; data: any }> = [];
  const responseQueue = Array.isArray(responses) ? [...responses] : [responses];
  const fallbackResponse = responseQueue[responseQueue.length - 1];
  const stream = vi.fn((_model: unknown, _context: unknown, streamOptions?: { signal?: AbortSignal }) => {
    const finalResponse = responseQueue.shift() ?? fallbackResponse;
    return {
      async *[Symbol.asyncIterator]() {
        if (options.streamed) yield { type: "text_delta", partial: options.streamedPartialUsage ? { ...finalResponse, usage } : finalResponse };
      },
      result: async () => {
        await options.resultGate;
        if (options.rejectResultWhenAborted && streamOptions?.signal?.aborted) throw new Error("provider aborted");
        return finalResponse;
      },
    };
  });
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
      getProvider: vi.fn(() => ({ stream })),
    },
    sessionManager: {
      getSessionId: () => "session-1",
      appendUsage,
    },
    ui: { notify: vi.fn(), setStatus: vi.fn() },
  } as any;
  return { ctx, entries, stream, pi };
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
    const appendUsage = vi.fn(() => ({ id: "usage-1", timestamp: "2026-01-02T03:04:05.000Z" }));
    const { ctx, entries } = setup(response("short summary"), appendUsage);
    ctx.sessionManager.getSessionId = () => { throw new Error("session id unavailable"); };

    const result = await harness.flush!(ctx, { previewedBatches: [batch(5_000)] });

    expect(result).toMatchObject({ ok: true, reason: "flushed" });
    expect(appendUsage).toHaveBeenCalledTimes(1);
    expect(latestStats(entries)).toMatchObject({ callCount: 1, totalCost: 0.1 });
    const sidecar = readFileSync(join(harness.agentDir, "context-prune", "usage.jsonl"), "utf8");
    expect(JSON.parse(sidecar)).toMatchObject({ sessionId: "", usageEntryId: "usage-1" });
  });

  it("does not warn twice when a session identity lookup recovers", async () => {
    let lookupFails = true;
    const appendUsage = vi.fn(() => { throw new Error("session usage failed"); });
    const { ctx } = setup([response("short summary"), response("short summary")], appendUsage);
    ctx.sessionManager.getSessionId = () => {
      if (lookupFails) throw new Error("session id unavailable");
      return "session-1";
    };

    await harness.flush!(ctx, { previewedBatches: [batch(5_000, "call-1", 7)] });
    lookupFails = false;
    await harness.flush!(ctx, { previewedBatches: [batch(5_000, "call-2", 8)] });

    const usageWarnings = ctx.ui.notify.mock.calls.filter(([message]: [string]) =>
      message.includes("could not record summarizer usage"),
    );
    expect(usageWarnings).toHaveLength(1);
  });

  it("does not warn twice across an identified session's transient lookup failure", async () => {
    let lookupState: "identified" | "failed" = "identified";
    const appendUsage = vi.fn(() => { throw new Error("session usage failed"); });
    const { ctx } = setup([
      response("short summary"),
      response("short summary"),
      response("short summary"),
    ], appendUsage);
    ctx.sessionManager.getSessionId = () => {
      if (lookupState === "failed") throw new Error("session id unavailable");
      return "session-1";
    };

    await harness.flush!(ctx, { previewedBatches: [batch(5_000, "call-1", 7)] });
    lookupState = "failed";
    await harness.flush!(ctx, { previewedBatches: [batch(5_000, "call-2", 8)] });
    lookupState = "identified";
    await harness.flush!(ctx, { previewedBatches: [batch(5_000, "call-3", 9)] });

    const usageWarnings = ctx.ui.notify.mock.calls.filter(([message]: [string]) =>
      message.includes("could not record summarizer usage"),
    );
    expect(usageWarnings).toHaveLength(1);
  });

  it("warns again when one session manager moves to a different identified session", async () => {
    let sessionId = "session-1";
    const appendUsage = vi.fn(() => { throw new Error("session usage failed"); });
    const { ctx } = setup([response("short summary"), response("short summary")], appendUsage);
    ctx.sessionManager.getSessionId = () => sessionId;

    await harness.flush!(ctx, { previewedBatches: [batch(5_000, "call-1", 7)] });
    sessionId = "session-2";
    await harness.flush!(ctx, { previewedBatches: [batch(5_000, "call-2", 8)] });

    const usageWarnings = ctx.ui.notify.mock.calls.filter(([message]: [string]) =>
      message.includes("could not record summarizer usage"),
    );
    expect(usageWarnings).toHaveLength(2);
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

  it("rejects a concurrent flush without starting a second provider call", async () => {
    let release!: () => void;
    const resultGate = new Promise<void>((resolve) => { release = resolve; });
    const appendUsage = vi.fn(() => ({ id: "usage-1", timestamp: "2026-01-02T03:04:05.000Z" }));
    const { ctx, stream } = setup(response("short summary"), appendUsage, { resultGate });

    const first = harness.flush!(ctx, { previewedBatches: [batch(5_000)] });
    await vi.waitFor(() => expect(stream).toHaveBeenCalledTimes(1));
    const second = await harness.flush!(ctx, { previewedBatches: [batch(5_000, "call-2", 8)] });

    expect(second).toEqual({ ok: false, reason: "already-flushing" });
    expect(stream).toHaveBeenCalledTimes(1);
    release();
    await expect(first).resolves.toMatchObject({ ok: true, reason: "flushed" });
  });

  it("does not drain work or call the provider when already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const appendUsage = vi.fn();
    const { ctx, stream } = setup(response("short summary"), appendUsage);
    const pending = batch(5_000);

    const aborted = await harness.flush!(ctx, {
      previewedBatches: [pending],
      signal: controller.signal,
    });
    const retried = await harness.flush!(ctx, { previewedBatches: [pending] });

    expect(aborted).toEqual({ ok: false, reason: "aborted" });
    expect(retried).toMatchObject({ ok: true, reason: "flushed" });
    expect(stream).toHaveBeenCalledTimes(1);
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
  it("advances the frontier without pruning raw output on an automatic oversized stream", async () => {
    const appendUsage = vi.fn(() => ({ id: "usage-1", timestamp: "2026-01-02T03:04:05.000Z" }));
    const { ctx, entries, stream, pi } = setup(response("s".repeat(701), { stopReason: "aborted" }), appendUsage, { streamed: true });
    const result = await harness.flush!(ctx, { previewedBatches: [batch(700)] });
    expect(result).toMatchObject({ ok: true, reason: "skipped-oversized", batchCount: 1 });
    expect(stream.mock.calls[0][2].signal.aborted).toBe(true);
    expect(entries.filter(({ customType }) => customType === CUSTOM_TYPE_FRONTIER).at(-1)?.data)
      .toMatchObject({ outcome: "skipped-oversized", attemptedBatchCount: 1 });
    expect(appendUsage).toHaveBeenCalledTimes(1);
    expect(latestStats(entries)).toMatchObject({ callCount: 1 });
    expect(pi.sendMessage).not.toHaveBeenCalled();
  });
  it("accounts for partial usage once when an oversized result resolves without usage", async () => {
    const appendUsage = vi.fn(() => ({ id: "usage-1", timestamp: "2026-01-02T03:04:05.000Z" }));
    const { ctx, entries } = setup(response("s".repeat(701), { stopReason: "aborted", usage: undefined }), appendUsage, {
      streamed: true, streamedPartialUsage: true,
    });
    const result = await harness.flush!(ctx, { previewedBatches: [batch(700)] });
    expect(result).toMatchObject({ ok: true, reason: "skipped-oversized" });
    expect(appendUsage).toHaveBeenCalledOnce();
    expect(latestStats(entries)).toMatchObject({ callCount: 1 });
  });

  it("keeps available partial usage when an oversized provider result rejects", async () => {
    const appendUsage = vi.fn(() => ({ id: "usage-1", timestamp: "2026-01-02T03:04:05.000Z" }));
    const { ctx, entries } = setup(response("s".repeat(701), { stopReason: "aborted" }), appendUsage, {
      streamed: true, rejectResultWhenAborted: true,
    });
    const result = await harness.flush!(ctx, { previewedBatches: [batch(700)] });
    expect(result).toMatchObject({ ok: true, reason: "skipped-oversized" });
    expect(appendUsage).toHaveBeenCalledTimes(1);
    expect(latestStats(entries)).toMatchObject({ callCount: 1 });
  });

  it("persists an out-of-order oversized skip when an earlier concurrent batch fails", async () => {
    const appendUsage = vi.fn(() => ({ id: "usage-1", timestamp: "2026-01-02T03:04:05.000Z" }));
    const { ctx, entries } = setup([
      response("", { stopReason: "error", errorMessage: "invalid credentials" }),
      response("s".repeat(701), { stopReason: "aborted" }),
    ], appendUsage, { streamed: true });
    const result = await harness.flush!(ctx, {
      previewedBatches: [batch(700, "failed", 1), batch(700, "oversized", 2)],
      onProgress: vi.fn(),
    });
    expect(result).toMatchObject({ ok: false, reason: "summarizer-failed" });
    expect(entries).toContainEqual(expect.objectContaining({
      customType: "context-prune-skipped-oversized",
      data: { toolCallIds: ["oversized"] },
    }));
    expect(entries.filter(({ customType }) => customType === CUSTOM_TYPE_FRONTIER)).toHaveLength(0);
  });

  it("does not claim a skip if its independent persistence write fails", async () => {
    const { ctx, entries, pi } = setup(response("s".repeat(701), { stopReason: "aborted" }), vi.fn(), { streamed: true });
    pi.appendEntry.mockImplementation(() => { throw new Error("skip persistence unavailable"); });
    const failed = await harness.flush!(ctx, { previewedBatches: [batch(700)] });
    expect(failed).toMatchObject({ ok: false, reason: "failed" });
    expect(entries).not.toContainEqual(expect.objectContaining({ customType: "context-prune-skipped-oversized" }));
    pi.appendEntry.mockImplementation((customType: string, data: unknown) => {
      entries.push({ customType, data });
      return `entry-${entries.length}`;
    });
    expect(await harness.flush!(ctx, { previewedBatches: [batch(700)] }))
      .toMatchObject({ ok: true, reason: "skipped-oversized" });
  });

  it("records a later streamed skip before an earlier summary persistence fails", async () => {
    const { ctx, entries } = setup([response("short"), response("s".repeat(701), { stopReason: "aborted" })], vi.fn(), {
      streamed: true, sendMessage: () => { throw new Error("This extension ctx is stale"); },
    });
    const result = await harness.flush!(ctx, {
      previewedBatches: [batch(700, "first", 1), batch(700, "oversized", 2)], onProgress: vi.fn(),
    });
    expect(result).toMatchObject({ ok: false });
    expect(entries).toContainEqual(expect.objectContaining({
      customType: "context-prune-skipped-oversized", data: { toolCallIds: ["oversized"] },
    }));
  });

  it("records a later rendered-oversized skip despite an earlier provider failure", async () => {
    const { ctx, entries, stream } = setup([
      response("", { stopReason: "error", errorMessage: "invalid credentials" }),
      response("s".repeat(680)),
    ], vi.fn(), { streamed: true });
    const result = await harness.flush!(ctx, {
      previewedBatches: [batch(700, "failed", 1), batch(700, "rendered-oversized", 2)], onProgress: vi.fn(),
    });
    expect(result).toMatchObject({ ok: false, reason: "summarizer-failed" });
    expect(stream.mock.calls[1][2].signal.aborted).toBe(false);
    expect(entries).toContainEqual(expect.objectContaining({
      customType: "context-prune-skipped-oversized", data: { toolCallIds: ["rendered-oversized"] },
    }));
    expect(entries.filter(({ customType }) => customType === CUSTOM_TYPE_FRONTIER)).toHaveLength(0);
  });
  it("attempts every independent skip marker even if an earlier marker write fails", async () => {
    const { ctx, entries, pi } = setup([
      response("s".repeat(701), { stopReason: "aborted" }),
      response("s".repeat(701), { stopReason: "aborted" }),
    ], vi.fn(), { streamed: true });
    const append = pi.appendEntry.getMockImplementation();
    pi.appendEntry.mockImplementation((customType: string, data: any) => {
      if (customType === "context-prune-skipped-oversized" && data.toolCallIds.includes("first")) {
        throw new Error("first marker unavailable");
      }
      return append(customType, data);
    });
    const result = await harness.flush!(ctx, {
      previewedBatches: [batch(700, "first", 1), batch(700, "second", 2)], onProgress: vi.fn(),
    });
    expect(result).toMatchObject({ ok: false, reason: "failed" });
    expect(entries.filter(({ customType }) => customType === "context-prune-skipped-oversized"))
      .toEqual([{ customType: "context-prune-skipped-oversized", data: { toolCallIds: ["second"] } }]);
    expect(entries.filter(({ customType }) => customType === CUSTOM_TYPE_FRONTIER)).toHaveLength(0);
  });

  it("keeps raw results when the fully rendered summary exactly matches raw length", async () => {
    const rawChars = 700;
    const refs = [{ shortId: "t1", toolCallId: "equal" }];
    const overhead = wrapSummaryForContext(formatSummaryToolCallRefs(refs)).length;
    const summary = "s".repeat(rawChars - overhead);
    expect(wrapSummaryForContext(summary + formatSummaryToolCallRefs(refs))).toHaveLength(rawChars);
    const { ctx, entries, pi } = setup(response(summary), vi.fn());
    const result = await harness.flush!(ctx, { previewedBatches: [batch(rawChars, "equal")] });
    expect(result).toMatchObject({ ok: true, reason: "skipped-oversized" });
    expect(pi.sendMessage).not.toHaveBeenCalled();
    expect(entries).toContainEqual(expect.objectContaining({
      customType: "context-prune-skipped-oversized", data: { toolCallIds: ["equal"] },
    }));
  });

  it("stops an oversized streamed batch, accounts usage, and settles the next batch normally", async () => {
    const appendUsage = vi.fn(() => ({ id: "usage-1", timestamp: "2026-01-02T03:04:05.000Z" }));
    const { ctx, entries, stream } = setup([response("s".repeat(701), { stopReason: "aborted" }), response("short")], appendUsage, { streamed: true });
    const progress: Array<[number, string]> = [];
    const result = await harness.flush!(ctx, {
      previewedBatches: [batch(700, "first", 1), batch(700, "second", 2)],
      onProgress: (index: number, _total: number, _batch: CapturedBatch, stage: string) => progress.push([index, stage]),
    });
    expect(result).toMatchObject({ ok: true, reason: "flushed", batchCount: 2 });
    expect(progress).toContainEqual([0, "skipped"]);
    expect(progress).toContainEqual([1, "done"]);
    expect(stream.mock.calls[0][2].signal.aborted).toBe(true);
    expect(stream.mock.calls[1][2].signal.aborted).toBe(false);
    expect(appendUsage).toHaveBeenCalledTimes(2);
    expect(latestStats(entries)).toMatchObject({ callCount: 2 });
  });
});
