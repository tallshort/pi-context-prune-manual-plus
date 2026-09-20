import { describe, expect, it, vi } from "vitest";
import { isManualPruneCancelInput, runAbortableBounded } from "../src/manual-prune-scheduler.js";

describe("manual prune cancellation", () => {
  it("recognizes q and Pi's configured cancel key", () => {
    expect(isManualPruneCancelInput("q", () => false)).toBe(true);
    expect(isManualPruneCancelInput("pi-cancel", (data) => data === "pi-cancel")).toBe(true);
    expect(isManualPruneCancelInput("x", () => false)).toBe(false);
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
