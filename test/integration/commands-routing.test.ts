import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ saveConfig: vi.fn() }));

vi.mock("@earendil-works/pi-tui", () => ({
  Container: class { addChild() {} }, Text: class {}, SettingsList: class {},
  truncateToWidth: (text: string) => text, visibleWidth: (text: string) => text.length,
}));
vi.mock("@earendil-works/pi-coding-agent", () => ({ DynamicBorder: class {}, getSettingsListTheme: () => ({}) }));
vi.mock("../../src/config.js", () => ({ saveConfig: mocks.saveConfig }));
vi.mock("../../src/tree-browser.js", () => ({ buildPruneTree: vi.fn(), TreeBrowser: class {} }));

import { registerCommands } from "../../src/commands.js";
import { DEFAULT_CONFIG } from "../../src/types.js";

function setup() {
  const registerCommand = vi.fn();
  const syncToolActivation = vi.fn();
  const flushPending = vi.fn();
  const capturePendingBatches = vi.fn(() => []);
  const currentConfig = { value: { ...DEFAULT_CONFIG, enabled: true } };
  registerCommands(
    { registerCommand, registerMessageRenderer: vi.fn() } as any,
    currentConfig,
    flushPending,
    capturePendingBatches,
    syncToolActivation,
    () => ({
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCost: 0,
      callCount: 0,
      totalPrunedRawChars: 0,
      totalPrunedSummaryChars: 0,
      retryCount: 0,
      finalFailureCount: 0,
      failureCounts: { "rate-limit": 0, network: 0, provider: 0, persistence: 0, cancelled: 0 },
    }),
    {} as any,
  );
  return {
    currentConfig,
    flushPending,
    capturePendingBatches,
    syncToolActivation,
    command: registerCommand.mock.calls[0][1],
  };
}

function ui(overrides: Record<string, unknown> = {}) {
  return {
    notify: vi.fn(),
    select: vi.fn(),
    setStatus: vi.fn(),
    theme: { fg: (_color: string, text: string) => text },
    ...overrides,
  };
}

describe("/pruner routing", () => {
  beforeEach(() => {
    mocks.saveConfig.mockClear();
  });
  it("routes a bare command through the picker without changing command behavior", async () => {
    const subject = setup();
    const commandUi = ui({ select: vi.fn(async () => "off       — disable context pruning") });

    await subject.command.handler("", { hasUI: true, ui: commandUi });

    expect(subject.currentConfig.value.enabled).toBe(false);
    expect(mocks.saveConfig).toHaveBeenCalledWith(subject.currentConfig.value);
    expect(commandUi.notify).toHaveBeenCalledWith("Context pruning disabled.");
    expect(subject.syncToolActivation).toHaveBeenCalledTimes(1);
    expect(subject.flushPending).not.toHaveBeenCalled();
  });

  it("leaves state untouched when the picker is cancelled", async () => {
    const subject = setup();
    const original = subject.currentConfig.value;
    const commandUi = ui({ select: vi.fn(async () => undefined) });

    await subject.command.handler("", { hasUI: true, ui: commandUi });

    expect(subject.currentConfig.value).toBe(original);
    expect(mocks.saveConfig).not.toHaveBeenCalled();
    expect(subject.syncToolActivation).not.toHaveBeenCalled();
    expect(subject.flushPending).not.toHaveBeenCalled();
  });

  it("reports unknown commands and preserves completion metadata", async () => {
    const subject = setup();
    const commandUi = ui();

    await subject.command.handler("does-not-exist", { hasUI: true, ui: commandUi });

    expect(commandUi.notify).toHaveBeenCalledWith(
      'Unknown subcommand: "does-not-exist". Run /pruner help for usage.',
    );
    expect(subject.command.getArgumentCompletions("man")).toEqual([
      expect.objectContaining({ value: "manual-concurrency" }),
    ]);
    expect(subject.flushPending).not.toHaveBeenCalled();
    expect(subject.capturePendingBatches).not.toHaveBeenCalled();
  });
});
