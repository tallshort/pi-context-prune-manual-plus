/** Returns true only for Pi's configured selection-cancel input. */
export function isManualPruneCancelInput(
  data: string,
  matchesCancel: (data: string) => boolean,
): boolean {
  return matchesCancel(data);
}

export type ManualPruneProgressState = "pending" | "running" | "done" | "skipped";

/** Formats the dynamic portion of the manual-prune overlay title. */
export function formatManualPruneProgressStatus(states: readonly ManualPruneProgressState[]): string {
  const completed = states.filter((state) => state === "done" || state === "skipped").length;
  const running = states.filter((state) => state === "running").length;
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
