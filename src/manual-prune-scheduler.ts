/** Returns true for q or Pi's configured selection-cancel input. */
export function isManualPruneCancelInput(
  data: string,
  matchesCancel: (data: string) => boolean,
): boolean {
  return data === "q" || matchesCancel(data);
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
