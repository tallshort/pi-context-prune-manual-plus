import { describe, expect, it, vi } from "vitest";
import { createManualPruneOverlayLifecycle, formatManualPruneProgressStatus, isManualPruneCancelInput, runAbortableBounded } from "../src/manual-prune-scheduler.js";

describe("manual prune cancellation", () => {
  it("recognizes only Pi's configured cancel key", () => {
    expect(isManualPruneCancelInput("q", () => false)).toBe(false);
    expect(isManualPruneCancelInput("pi-cancel", (data) => data === "pi-cancel")).toBe(true);
    expect(isManualPruneCancelInput("x", () => false)).toBe(false);
  });

  it("reports completed batches so the overlay title advances", () => {
    const initial = [...Array<"running">(8).fill("running"), ...Array<"pending">(153).fill("pending")];
    const afterOneCompletes = ["done" as const, ...initial.slice(1)];

    expect(formatManualPruneProgressStatus(initial)).toBe("0/161 complete · 8 running");
    expect(formatManualPruneProgressStatus(afterOneCompletes)).toBe("1/161 complete · 7 running");
  });
  it("runs every batch in order when not cancelled", async () => {
    const started: number[] = [];
    const results = await runAbortableBounded([0, 1, 2, 3], 2, undefined, async (batch) => {
      started.push(batch);
      return batch * 10;
    });

    expect(started).toEqual([0, 1, 2, 3]);
    expect(results).toEqual([0, 10, 20, 30]);
  });

  it("cancels and closes the overlay lifecycle exactly once", () => {
    const close = vi.fn();
    const lifecycle = createManualPruneOverlayLifecycle();
    lifecycle.setClose(close);

    lifecycle.cancel();
    lifecycle.close();
    lifecycle.close();

    expect(lifecycle.signal.aborted).toBe(true);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("does not schedule batch nine or later after cancellation", async () => {
    const controller = new AbortController();
    const started: number[] = [];
    const releases: Array<() => void> = [];
    const waitForStart = vi.fn();

    const resultsPromise = runAbortableBounded(
      Array.from({ length: 12 }, (_, index) => index),
      8,
      controller.signal,
      async (batch) => {
        started.push(batch);
        waitForStart();
        await new Promise<void>((resolve) => {
          releases[batch] = resolve;
        });
        return batch;
      },
    );

    await vi.waitFor(() => expect(started).toEqual([0, 1, 2, 3, 4, 5, 6, 7]));
    controller.abort();
    releases.slice(0, 8).forEach((release) => release());

    await expect(resultsPromise).resolves.toEqual([0, 1, 2, 3, 4, 5, 6, 7, null, null, null, null]);
    expect(waitForStart).toHaveBeenCalledTimes(8);
  });
});
