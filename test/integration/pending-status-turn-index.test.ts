import { describe, expect, it, vi } from "vitest";

const { loadConfig } = vi.hoisted(() => ({ loadConfig: vi.fn() }));
vi.mock("../../src/config.js", () => ({ loadConfig }));

import extension from "../../index.js";
import { DEFAULT_CONFIG, CUSTOM_TYPE_FRONTIER } from "../../src/types.js";

function toolTurn(id: string, name = "read") {
  const assistant = { type: "message", id: `assistant-${id}`, timestamp: "2026-01-01T00:00:00Z", message: { role: "assistant", content: [{ type: "toolCall", id, name, input: {} }] } };
  const result = { type: "message", id: `result-${id}`, message: { role: "toolResult", toolCallId: id, content: [{ type: "text", text: "tool result" }] } };
  return [assistant, result];
}

function harness() {
  const handlers = new Map<string, Function>();
  const statuses: string[] = [];
  const pi = { on: (event: string, handler: Function) => handlers.set(event, handler), registerTool: vi.fn(), registerCommand: vi.fn(), registerMessageRenderer: vi.fn(), getActiveTools: () => [], setActiveTools: vi.fn() };
  extension(pi as any);
  const entries: any[] = [
    { type: "custom", id: "frontier", customType: CUSTOM_TYPE_FRONTIER, data: { lastAttemptedTurnIndex: 1, lastAttemptedToolCallId: "old", lastAttemptedToolName: "read", lastAttemptedTimestamp: 0, attemptedBatchCount: 1, attemptedToolCallCount: 1, rawCharCount: 20, summaryCharCount: 10, outcome: "summarized" } },
    ...toolTurn("filler"),
    ...toolTurn("old"),
    ...toolTurn("earlier"),
  ];
  let visibleIds: Set<string> | undefined;
  const ctx = {
    sessionManager: { getBranch: () => entries, buildSessionProjection: () => ({ entries: entries.filter((e) => e.type === "message" && (!visibleIds || visibleIds.has(e.id))).map((e) => ({ sourceEntry: e, messages: [e.message] })) }) },
    ui: { notify: vi.fn(), setStatus: (_id: string, text?: string) => statuses.push(text ?? ""), theme: { fg: (_color: string, text: string) => text } },
  };
  return { handlers, statuses, entries, ctx, setVisibleIds: (ids: string[]) => { visibleIds = new Set(ids); } };
}

describe("on-demand pending status across agent runs", () => {
  it("shows existing pending batches immediately when a session is reopened", async () => {
    loadConfig.mockResolvedValue({ ...DEFAULT_CONFIG, enabled: true, pruneOn: "on-demand", showPruneStatusLine: true });
    const { handlers, statuses, ctx } = harness();
    await handlers.get("session_start")!({}, ctx);
    expect(statuses.at(-1)).toContain("1 pending");
  });

  it("refreshes the footer after navigating to a branch without pending batches", async () => {
    loadConfig.mockResolvedValue({ ...DEFAULT_CONFIG, enabled: true, pruneOn: "on-demand", showPruneStatusLine: true });
    const { handlers, statuses, ctx, setVisibleIds } = harness();
    await handlers.get("session_start")!({}, ctx);
    await handlers.get("agent_end")!({}, ctx);
    expect(statuses.at(-1)).toContain("1 pending");
    setVisibleIds(["assistant-old", "result-old"]);
    await handlers.get("session_tree")!({}, ctx);
    expect(statuses.at(-1)).not.toContain("pending");
  });

  it("never displays pending on a disabled pruner after branch navigation or compaction", async () => {
    loadConfig.mockResolvedValue({ ...DEFAULT_CONFIG, enabled: false, pruneOn: "on-demand", showPruneStatusLine: true });
    const { handlers, statuses, ctx } = harness();
    await handlers.get("session_start")!({}, ctx);
    await handlers.get("session_tree")!({}, ctx);
    expect(statuses.at(-1)).toBe("prune: OFF (On demand)");
    await handlers.get("session_compact")!({}, ctx);
    expect(statuses.at(-1)).toBe("prune: OFF (On demand)");
  });
  it.each(["on-context-tag", "agent-message"] as const)("refreshes %s after branch navigation and does not restore a stale count at agent_end", async (pruneOn) => {
    loadConfig.mockResolvedValue({ ...DEFAULT_CONFIG, enabled: true, pruneOn, showPruneStatusLine: true });
    const { handlers, statuses, entries, ctx, setVisibleIds } = harness();
    await handlers.get("session_start")!({}, ctx);
    const [assistant, result] = toolTurn("new");
    entries.push(assistant, result);
    await handlers.get("turn_end")!({ message: assistant.message, toolResults: [result.message], turnIndex: 0 }, ctx);
    expect(statuses.at(-1)).toBe("prune: 2 pending");

    setVisibleIds(["assistant-old", "result-old"]);
    await handlers.get("session_tree")!({}, ctx);
    expect(statuses.at(-1)).not.toContain("pending");
    await handlers.get("agent_end")!({}, ctx);
    expect(statuses.at(-1)).not.toContain("pending");
  });

  it("refreshes non-on-demand footer after compaction and later tool turns", async () => {
    loadConfig.mockResolvedValue({ ...DEFAULT_CONFIG, enabled: true, pruneOn: "on-context-tag", showPruneStatusLine: true });
    const { handlers, statuses, entries, ctx, setVisibleIds } = harness();
    await handlers.get("session_start")!({}, ctx);
    const [assistant, result] = toolTurn("new");
    entries.push(assistant, result);
    await handlers.get("turn_end")!({ message: assistant.message, toolResults: [result.message], turnIndex: 0 }, ctx);
    expect(statuses.at(-1)).toBe("prune: 2 pending");

    setVisibleIds(["assistant-old", "result-old"]);
    await handlers.get("session_compact")!({}, ctx);
    expect(statuses.at(-1)).not.toContain("pending");
    await handlers.get("agent_end")!({}, ctx);
    expect(statuses.at(-1)).not.toContain("pending");

    const [nextAssistant, nextResult] = toolTurn("after-compaction");
    entries.push(nextAssistant, nextResult);
    setVisibleIds(["assistant-old", "result-old", "assistant-after-compaction", "result-after-compaction"]);
    await handlers.get("turn_end")!({ message: nextAssistant.message, toolResults: [nextResult.message], turnIndex: 1 }, ctx);
    expect(statuses.at(-1)).toBe("prune: 1 pending");
  });

  it("does not show pending on a disabled non-on-demand footer", async () => {
    loadConfig.mockResolvedValue({ ...DEFAULT_CONFIG, enabled: false, pruneOn: "on-context-tag", showPruneStatusLine: true });
    const { handlers, statuses, ctx } = harness();
    await handlers.get("session_start")!({}, ctx);
    await handlers.get("session_tree")!({}, ctx);
    await handlers.get("session_compact")!({}, ctx);
    expect(statuses.at(-1)).toBe("prune: OFF (On context tag)");
  });

  it("queues the current turn after an older frontier even outside on-demand mode", async () => {
    loadConfig.mockResolvedValue({ ...DEFAULT_CONFIG, enabled: true, pruneOn: "on-context-tag", showPruneStatusLine: true });
    const { handlers, statuses, entries, ctx } = harness();
    await handlers.get("session_start")!({}, ctx);
    const [assistant, result] = toolTurn("new");
    entries.push(assistant, result);
    await handlers.get("turn_end")!({ message: assistant.message, toolResults: [result.message], turnIndex: 0 }, ctx);
    expect(statuses.at(-1)).toBe("prune: 2 pending");
  });
  it("refreshes from session-relative pending batches when Pi's turnIndex restarts at zero", async () => {
    loadConfig.mockResolvedValue({ ...DEFAULT_CONFIG, enabled: true, pruneOn: "on-demand", showPruneStatusLine: true });
    const { handlers, statuses, entries, ctx } = harness();
    await handlers.get("session_start")!({}, ctx);
    await handlers.get("agent_end")!({}, ctx);
    expect(statuses.at(-1)).toContain("1 pending");

    const [assistant, result] = toolTurn("new");
    entries.push(assistant, result);
    await handlers.get("turn_end")!({ message: assistant.message, toolResults: [result.message], turnIndex: 0 }, ctx);
    expect(statuses.at(-1)).toContain("2 pending");
  });

  it("refreshes a stale status even when compaction removes the previous pending tail", async () => {
    loadConfig.mockResolvedValue({ ...DEFAULT_CONFIG, enabled: true, pruneOn: "on-demand", showPruneStatusLine: true });
    const { handlers, statuses, entries, ctx, setVisibleIds } = harness();
    await handlers.get("session_start")!({}, ctx);
    await handlers.get("agent_end")!({}, ctx);
    expect(statuses.at(-1)).toContain("1 pending");

    // Pi's compaction keeps the old session entries but projects only the retained tail.
    setVisibleIds(["assistant-old", "result-old"]);
    await handlers.get("session_compact")!({}, ctx);
    expect(statuses.at(-1)).not.toContain("pending");

    const [assistant, result] = toolTurn("new");
    entries.push(assistant, result);
    setVisibleIds(["assistant-old", "result-old", "assistant-new", "result-new"]);
    await handlers.get("turn_end")!({ message: assistant.message, toolResults: [result.message], turnIndex: 0 }, ctx);
    expect(statuses.at(-1)).toContain("1 pending");
  });
});
