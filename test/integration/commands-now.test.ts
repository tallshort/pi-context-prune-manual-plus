import { describe, expect, it, vi } from "vitest";

vi.mock("@earendil-works/pi-tui", () => {
  class Container {
    addChild() {}
  }

  return {
    Container,
    Text: class Text {},
    SettingsList: class SettingsList {},
    truncateToWidth: (text: string, width: number) => text.slice(0, width),
    visibleWidth: (text: string) => text.length,
  };
});

vi.mock("@earendil-works/pi-coding-agent", () => ({
  DynamicBorder: class DynamicBorder {},
  getSettingsListTheme: () => ({}),
}));

vi.mock("../../src/config.js", () => ({ saveConfig: vi.fn() }));
vi.mock("../../src/tree-browser.js", () => ({
  buildPruneTree: vi.fn(),
  TreeBrowser: class TreeBrowser {},
}));

import { registerCommands, selectProgressWindow } from "../../src/commands.js";
import { DEFAULT_CONFIG, type CapturedBatch, type FlushOptions } from "../../src/types.js";

describe("/pruner now", () => {
  it("focuses a centered progress overlay, reports progress, cancels through Pi, and closes after flush", async () => {
    const command = { register: vi.fn() };
    const rendered = { requestRender: vi.fn() };
    const theme = { fg: (_color: string, text: string) => text };
    const keybindings = { matches: vi.fn((data: string, binding: string) => binding === "tui.select.cancel" && data === "pi-cancel") };
    const focus = vi.fn();
    const done = vi.fn();
    let overlay: { handleInput(data: string): void; render(width: number): string[] } | undefined;
    let customOptions: any;
    let flushOptions: FlushOptions | undefined;
    let finishFlush: (() => void) | undefined;

    const ui = {
      custom: vi.fn((factory: any, options: any) => {
        customOptions = options;
        return new Promise<void>((resolve) => {
          const close = (value: undefined) => {
            done(value);
            resolve();
          };
          overlay = factory(rendered, theme, keybindings, close);
          options.onHandle({ focus });
        });
      }),
      notify: vi.fn(),
      setStatus: vi.fn(),
      theme,
    };
    const ctx = { hasUI: true, ui };
    const batches: CapturedBatch[] = [{
      turnIndex: 0,
      timestamp: 0,
      assistantText: "",
      toolCalls: [{ toolCallId: "call-1", toolName: "read", args: {}, resultText: "abcdefghijklmnopqrst", isError: false }],
    }];
    const flushPending = vi.fn(async (_ctx: unknown, options?: FlushOptions) => {
      flushOptions = options;
      options?.onProgress?.(0, 1, batches[0], "start");
      options?.onBatchTextProgress?.(0, 1, batches[0], 12);
      await new Promise<void>((resolve) => { finishFlush = resolve; });
      options?.onProgress?.(0, 1, batches[0], "done");
      return { ok: true as const, reason: "cancelled" as const, batchCount: 1, toolCallCount: 1, rawCharCount: 20, summaryCharCount: 12 };
    });

    registerCommands(
      { registerCommand: command.register, registerMessageRenderer: vi.fn() } as any,
      { value: { ...DEFAULT_CONFIG, enabled: true } },
      flushPending as any,
      () => batches,
      vi.fn(),
      () => ({ totalInputTokens: 0, totalOutputTokens: 0, totalCost: 0, callCount: 0, totalPrunedRawChars: 0, totalPrunedSummaryChars: 0 }),
      {} as any,
    );

    const handler = command.register.mock.calls[0][1].handler("now", ctx);
    await vi.waitFor(() => expect(overlay).toBeDefined());

    expect(customOptions).toMatchObject({
      overlay: true,
      overlayOptions: { width: 80, maxHeight: "80%", anchor: "center" },
    });
    expect(focus).toHaveBeenCalledTimes(1);
    expect(overlay!.render(100).join("\n")).toContain("0/1 complete · 1 running");
    expect(overlay!.render(100).join("\n")).toContain("12 summary chars / 20 raw chars");

    overlay!.handleInput("pi-cancel");
    expect(keybindings.matches).toHaveBeenCalledWith("pi-cancel", "tui.select.cancel");
    expect(flushOptions!.signal?.aborted).toBe(true);

    finishFlush!();
    await handler;

    expect(overlay!.render(100).join("\n")).toContain("1/1 complete · 0 running");
    expect(overlay!.render(100).join("\n")).toContain("✓ Batch 1/1 · 1 tool call · 12 summary chars / 20 raw chars");
    expect(done).toHaveBeenCalledTimes(1);
    expect(ui.notify).toHaveBeenCalledWith(
      "pruner: cancellation complete — retained 1 completed batch(es); 0 remain pending",
      "info",
    );
  });
  it("renders retry and terminal failure states with the error icon color", async () => {
    const command = { register: vi.fn() };
    const rendered = { requestRender: vi.fn() };
    const theme = { fg: (color: string, text: string) => `<${color}>${text}</${color}>` };
    let overlay: { render(width: number): string[] } | undefined;
    let release: (() => void) | undefined;
    const ui = {
      custom: vi.fn((factory: any, options: any) => new Promise<void>((resolve) => {
        overlay = factory(rendered, theme, { matches: () => false }, resolve);
        options.onHandle({ focus: vi.fn() });
      })),
      notify: vi.fn(), setStatus: vi.fn(), theme,
    };
    const ctx = { hasUI: true, ui };
    const batches: CapturedBatch[] = [{ turnIndex: 0, timestamp: 0, assistantText: "", toolCalls: [{ toolCallId: "call-1", toolName: "read", args: {}, resultText: "raw", isError: false }] }];
    const flushPending = vi.fn(async (_ctx: unknown, options?: FlushOptions) => {
      options?.onProgress?.(0, 1, batches[0], "start", { attempts: 1, retryCount: 0 });
      options?.onProgress?.(0, 1, batches[0], "retry", { attempts: 1, retryCount: 1, failureKind: "rate-limit", failureMessage: "rate limited" });
      await new Promise<void>((resolve) => { release = resolve; });
      options?.onProgress?.(0, 1, batches[0], "failed", { attempts: 2, retryCount: 1, failureKind: "network", failureMessage: "network error" });
      return { ok: false as const, reason: "summarizer-failed" };
    });

    registerCommands({ registerCommand: command.register, registerMessageRenderer: vi.fn() } as any, { value: { ...DEFAULT_CONFIG, enabled: true } }, flushPending as any, () => batches, vi.fn(), () => ({ totalInputTokens: 0, totalOutputTokens: 0, totalCost: 0, callCount: 0, totalPrunedRawChars: 0, totalPrunedSummaryChars: 0, retryCount: 0, finalFailureCount: 0, failureCounts: { "rate-limit": 0, network: 0, provider: 0, persistence: 0, cancelled: 0 } }), {} as any);
    const handler = command.register.mock.calls[0][1].handler("now", ctx);
    await vi.waitFor(() => expect(overlay).toBeDefined());
    expect(overlay!.render(100).join("\n")).toContain("<accent>↻</accent><text> Batch 1/1 · retry 1/1 · rate limited");

    release!();
    await handler;
    const output = overlay!.render(100).join("\n");
    expect(output).toContain("<error>✗</error><text> Batch 1/1 · failed after 2 attempts · network error");
  });
  it("fast-forwards past leading terminal rows", () => {
    const rows = ["done", "skipped", "failed", "running", "pending", "done"].map((status, index) => ({ index, status: status as any }));
    expect(selectProgressWindow(rows, 3).map((row) => row.index)).toEqual([3, 4, 5]);
  });
});
