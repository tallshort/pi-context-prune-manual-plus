import { describe, expect, it, vi } from "vitest";

const { loadConfig } = vi.hoisted(() => ({ loadConfig: vi.fn() }));
vi.mock("../../src/config.js", () => ({ loadConfig }));

import extension from "../../index.js";
import { AGENTIC_AUTO_SYSTEM_PROMPT, CONTEXT_PRUNE_TOOL_NAME, DEFAULT_CONFIG, CUSTOM_TYPE_INDEX } from "../../src/types.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("context hydration ordering", () => {
  it("initializes agentic-auto before session_start and prunes persisted results", async () => {
    loadConfig.mockResolvedValue({ ...DEFAULT_CONFIG, enabled: true, pruneOn: "agentic-auto" });
    const handlers = new Map<string, Function>();
    let activeTools: string[] = [];
    const pi = {
      on: vi.fn((name, handler) => handlers.set(name, handler)),
      registerTool: vi.fn(), registerCommand: vi.fn(), registerMessageRenderer: vi.fn(),
      getActiveTools: vi.fn(() => activeTools),
      setActiveTools: vi.fn((tools) => { activeTools = tools; }),
    };
    extension(pi as any);
    const ctx = {
      sessionManager: { getBranch: () => [{ type: "custom", customType: CUSTOM_TYPE_INDEX, data: { toolCalls: [{ toolCallId: "persisted", toolName: "read", args: {}, resultText: "saved", isError: false, turnIndex: 0, timestamp: 0 }] } }] },
    };

    const system = await handlers.get("before_agent_start")!({ systemPrompt: "base" }, ctx);
    const context = await handlers.get("context")!({ messages: [{ role: "toolResult", toolCallId: "persisted", content: [{ type: "text", text: "saved" }] }] }, ctx);

    expect(loadConfig).toHaveBeenCalledOnce();
    expect(system.systemPrompt).toContain(AGENTIC_AUTO_SYSTEM_PROMPT);
    expect(activeTools).toContain(CONTEXT_PRUNE_TOOL_NAME);
    expect(context).toEqual({ messages: [] });
  });

  it("reloads persisted configuration on every session_start", async () => {
    loadConfig.mockReset();
    loadConfig.mockResolvedValueOnce({ ...DEFAULT_CONFIG, enabled: true, pruneOn: "agent-message" }).mockResolvedValueOnce({ ...DEFAULT_CONFIG, enabled: false, pruneOn: "on-demand" });
    const handlers = new Map<string, Function>();
    const pi = { on: vi.fn((name, handler) => handlers.set(name, handler)), registerTool: vi.fn(), registerCommand: vi.fn(), registerMessageRenderer: vi.fn(), getActiveTools: vi.fn(() => []), setActiveTools: vi.fn() };
    extension(pi as any);
    const ctx = { sessionManager: { getBranch: () => [] }, ui: { notify: vi.fn(), setStatus: vi.fn(), theme: { fg: vi.fn((_color, text) => text) } } };

    await handlers.get("session_start")!({}, ctx);
    await handlers.get("session_start")!({}, ctx);

    expect(loadConfig).toHaveBeenCalledTimes(2);
  });

  it("queues a session refresh after an in-flight early config load", async () => {
    loadConfig.mockReset();
    const early = deferred<any>();
    const refresh = deferred<any>();
    loadConfig.mockReturnValueOnce(early.promise).mockReturnValueOnce(refresh.promise);
    const handlers = new Map<string, Function>();
    const pi = { on: vi.fn((name, handler) => handlers.set(name, handler)), registerTool: vi.fn(), registerCommand: vi.fn(), registerMessageRenderer: vi.fn(), getActiveTools: vi.fn(() => []), setActiveTools: vi.fn() };
    extension(pi as any);
    const ctx = { sessionManager: { getBranch: () => [] }, ui: { notify: vi.fn(), setStatus: vi.fn(), theme: { fg: vi.fn((_color, text) => text) } } };

    const earlyStart = handlers.get("before_agent_start")!({ systemPrompt: "base" }, ctx);
    const sessionStart = handlers.get("session_start")!({}, ctx);
    await Promise.resolve();
    expect(loadConfig).toHaveBeenCalledOnce();

    early.resolve({ ...DEFAULT_CONFIG, enabled: true, pruneOn: "agentic-auto" });
    await earlyStart;
    await Promise.resolve();
    expect(loadConfig).toHaveBeenCalledTimes(2);

    refresh.resolve({ ...DEFAULT_CONFIG, enabled: false, pruneOn: "on-demand" });
    await sessionStart;
    expect(await handlers.get("before_agent_start")!({ systemPrompt: "base" }, ctx)).toBeUndefined();
  });

  it("fails open when persisted hydration data is malformed", async () => {
    loadConfig.mockReset();
    loadConfig.mockResolvedValue({ ...DEFAULT_CONFIG, enabled: true, pruneOn: "on-demand" });
    const handlers = new Map<string, Function>();
    const pi = { on: vi.fn((name, handler) => handlers.set(name, handler)), registerTool: vi.fn(), registerCommand: vi.fn(), registerMessageRenderer: vi.fn(), getActiveTools: vi.fn(() => []), setActiveTools: vi.fn() };
    extension(pi as any);
    const ctx = {
      sessionManager: {
        getBranch: () => [{ type: "custom", customType: CUSTOM_TYPE_INDEX, data: { toolCalls: [null] } }],
      },
    };
    const event = { messages: [{ role: "toolResult", toolCallId: "untrusted", content: [{ type: "text", text: "keep visible" }] }] };

    await expect(handlers.get("context")!(event, ctx)).resolves.toBeUndefined();
  });
});
