/** Returns true only for Pi's configured selection-cancel input. */
export function isManualPruneCancelInput(
  data: string,
  matchesCancel: (data: string) => boolean,
): boolean {
  return matchesCancel(data);
}

export interface ManualPruneOverlayLifecycle {
  readonly signal: AbortSignal;
  cancel(): void;
  setClose(close: () => void): void;
  close(): void;
}

/** Owns cancellation and one-time cleanup for the manual-prune overlay. */
export function createManualPruneOverlayLifecycle(): ManualPruneOverlayLifecycle {
  const controller = new AbortController();
  let closeHandler: (() => void) | undefined;
  let closed = false;

  return {
    signal: controller.signal,
    cancel: () => controller.abort(),
    setClose: (close) => {
      closeHandler = close;
    },
    close: () => {
      if (closed) return;
      closed = true;
      closeHandler?.();
    },
  };
}

export type ManualPruneProgressState = "pending" | "running" | "retrying" | "done" | "failed" | "skipped";

/** Formats the dynamic portion of the manual-prune overlay title. */
export function formatManualPruneProgressStatus(states: readonly ManualPruneProgressState[]): string {
  const completed = states.filter((state) => state === "done" || state === "skipped" || state === "failed").length;
  const running = states.filter((state) => state === "running" || state === "retrying").length;
  return `${completed}/${states.length} complete · ${running} running`;
}

/**
 * Runs work with bounded concurrency. Once the signal is aborted it lets active
 * work finish, but never dispatches another item; undispatched slots are null.
 */
export async function runAbortableBounded<T, R>(
  items: readonly T[],
  concurrency: number,
  signal: AbortSignal | undefined,
  runItem: (item: T, index: number) => Promise<R | null>,
): Promise<(R | null)[]> {
  const results: (R | null)[] = Array.from({ length: items.length }, () => null);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, concurrency), items.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length && !signal?.aborted) {
        const index = nextIndex++;
        results[index] = await runItem(items[index], index);
      }
    }),
  );

  return results;
}

/** Runs one attempt, then at most one more when its result is retryable. */
export async function runWithOneRetry<T>(
  run: () => Promise<T>,
  shouldRetry: (result: T) => boolean,
): Promise<{ value: T; attempts: number; retryCount: number }> {
  const first = await run();
  if (!shouldRetry(first)) return { value: first, attempts: 1, retryCount: 0 };
  // Yield once so the retrying row can render before its second request starts.
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  const second = await run();
  return { value: second, attempts: 2, retryCount: 1 };
}
