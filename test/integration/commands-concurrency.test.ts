import { describe, expect, it, vi } from "vitest";

vi.mock("@earendil-works/pi-tui", () => ({
  Container: class { addChild() {} }, Text: class {}, SettingsList: class {},
  truncateToWidth: (text: string) => text, visibleWidth: (text: string) => text.length,
}));
vi.mock("@earendil-works/pi-coding-agent", () => ({ DynamicBorder: class {}, getSettingsListTheme: () => ({}) }));
vi.mock("../../src/config.js", () => ({ saveConfig: vi.fn() }));
vi.mock("../../src/tree-browser.js", () => ({ buildPruneTree: vi.fn(), TreeBrowser: class {} }));

import { registerCommands } from "../../src/commands.js";
import { DEFAULT_CONFIG } from "../../src/types.js";

describe("/pruner manual-concurrency", () => {
  it("updates the persisted manual concurrency and rejects unsafe values", async () => {
    const command = { register: vi.fn() };
    const ui = { notify: vi.fn(), setStatus: vi.fn(), theme: { fg: (_color: string, text: string) => text } };
    const currentConfig = { value: { ...DEFAULT_CONFIG, enabled: true } };
    registerCommands(
      { registerCommand: command.register, registerMessageRenderer: vi.fn() } as any,
      currentConfig,
      vi.fn(), vi.fn(() => []), vi.fn(),
      () => ({ totalInputTokens: 0, totalOutputTokens: 0, totalCost: 0, callCount: 0, totalPrunedRawChars: 0, totalPrunedSummaryChars: 0, retryCount: 0, finalFailureCount: 0, failureCounts: { "rate-limit": 0, network: 0, provider: 0, persistence: 0, cancelled: 0 } }),
      {} as any,
    );
    const handler = command.register.mock.calls[0][1].handler;

    await handler("manual-concurrency 3", { hasUI: true, ui });
    expect(currentConfig.value.manualPruneConcurrency).toBe(3);
    expect(ui.notify).toHaveBeenLastCalledWith("Manual prune concurrency set to: 3");

    await handler("manual-concurrency 17", { hasUI: true, ui });
    expect(currentConfig.value.manualPruneConcurrency).toBe(3);
    expect(ui.notify).toHaveBeenLastCalledWith("Invalid concurrency: 17. Use an integer from 1 to 16.", "error");
  });
});
