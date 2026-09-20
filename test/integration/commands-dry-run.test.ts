import { describe, expect, it, vi } from "vitest";

vi.mock("@earendil-works/pi-tui", () => ({
  Container: class { addChild() {} }, Text: class {}, SettingsList: class {},
  truncateToWidth: (text: string) => text, visibleWidth: (text: string) => text.length,
}));
vi.mock("@earendil-works/pi-coding-agent", () => ({ DynamicBorder: class {}, getSettingsListTheme: () => ({}) }));
vi.mock("../../src/config.js", () => ({ saveConfig: vi.fn() }));
vi.mock("../../src/tree-browser.js", () => ({ buildPruneTree: vi.fn(), TreeBrowser: class {} }));

import { registerCommands } from "../../src/commands.js";
import { DEFAULT_CONFIG, type CapturedBatch } from "../../src/types.js";

describe("/pruner dry-run", () => {
  it("reports candidates without flushing, persistence, or state mutation", async () => {
    const command = { register: vi.fn() };
    const ui = { notify: vi.fn(), setStatus: vi.fn(), theme: { fg: (_color: string, text: string) => text } };
    const batches: CapturedBatch[] = [
      { turnIndex: 0, timestamp: 0, assistantText: "", toolCalls: [{ toolCallId: "small", toolName: "read", args: {}, resultText: "12345", isError: false }] },
      { turnIndex: 1, timestamp: 1, assistantText: "", toolCalls: [{ toolCallId: "large", toolName: "read", args: {}, resultText: "1234567890", isError: false }] },
    ];
    const flushPending = vi.fn();
    const capturePendingBatches = vi.fn(() => batches);

    registerCommands(
      { registerCommand: command.register, registerMessageRenderer: vi.fn() } as any,
      { value: { ...DEFAULT_CONFIG, enabled: true, minRawCharsThreshold: 5 } },
      flushPending,
      capturePendingBatches,
      vi.fn(),
      () => ({ totalInputTokens: 0, totalOutputTokens: 0, totalCost: 0, callCount: 1, totalPrunedRawChars: 100, totalPrunedSummaryChars: 20, retryCount: 0, finalFailureCount: 0, failureCounts: { "rate-limit": 0, network: 0, provider: 0, persistence: 0, cancelled: 0 } }),
      {} as any,
    );

    await command.register.mock.calls[0][1].handler("dry-run", { hasUI: true, ui });

    expect(capturePendingBatches).toHaveBeenCalledTimes(1);
    expect(flushPending).not.toHaveBeenCalled();
    expect(batches).toHaveLength(2);
    expect(ui.notify).toHaveBeenCalledWith(expect.stringContaining("pruner dry-run (no changes made):"), "info");
    expect(ui.notify).toHaveBeenCalledWith(expect.stringContaining("candidates:  1 batches, 1 tool calls, 10 raw chars"), "info");
    expect(ui.notify).toHaveBeenCalledWith(expect.stringContaining("estimate:    ~8 chars saved; ~2 summary chars"), "info");
  });
});
