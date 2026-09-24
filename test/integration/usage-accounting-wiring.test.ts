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

function batch(rawChars: number): CapturedBatch {
  return {
    turnIndex: 7,
    timestamp: 1,
    assistantText: "",
    toolCalls: [{
      toolCallId: "call-1",
      toolName: "read",
      args: {},
      resultText: "x".repeat(rawChars),
      isError: false,
    }],
  };
}

function response(summary: string) {
  return {
    role: "assistant",
    content: [{ type: "text", text: summary }],
    provider: "provider",
    model: "requested-model",
    responseModel: "actual-model",
    usage,
    stopReason: "stop",
    timestamp: 1,
  };
}

function setup(summary: string, appendUsage: ReturnType<typeof vi.fn>) {
  const entries: Array<{ customType: string; data: any }> = [];
  const pi = {
    on: vi.fn(),
    appendEntry: vi.fn((customType: string, data: any) => {
      entries.push({ customType, data });
      return `entry-${entries.length}`;
    }),
    sendMessage: vi.fn(),
    getActiveTools: vi.fn(() => []),
    setActiveTools: vi.fn(),
  } as any;
  registerExtension(pi);

  const finalResponse = response(summary);
  const ctx = {
    model: { provider: "provider", id: "requested-model" },
    modelRegistry: {
      getApiKeyAndHeaders: vi.fn(async () => ({ ok: true, apiKey: "key" })),
      getProvider: vi.fn(() => ({
        stream: () => ({
          async *[Symbol.asyncIterator]() {},
          result: async () => finalResponse,
        }),
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
    const { ctx, entries } = setup("short summary", appendUsage);

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
    const { ctx, entries } = setup("s".repeat(2_000), appendUsage);

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
});
