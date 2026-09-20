/** Reconciles completed flush work with retry and frontier boundaries. */
export interface FlushSettlement {
  processIndexes: number[];
  restoreIndexes: number[];
  frontierIndexes: number[];
}

/**
 * Plans which completed batches can be persisted, which must be retried, and
 * how far the frontier may advance. Normal failures preserve ordered retry
 * semantics; cancellation retains completed work behind an unfinished hole.
 */
export function planFlushSettlement(
  completed: readonly boolean[],
  wasCancelled: boolean,
): FlushSettlement {
  if (wasCancelled) {
    const processIndexes = completed.flatMap((isComplete, index) => isComplete ? [index] : []);
    const restoreIndexes = completed.flatMap((isComplete, index) => isComplete ? [] : [index]);
    const firstUnfinishedIndex = completed.findIndex((isComplete) => !isComplete);
    const frontierEnd = firstUnfinishedIndex === -1 ? completed.length : firstUnfinishedIndex;

    return {
      processIndexes,
      restoreIndexes,
      frontierIndexes: Array.from({ length: frontierEnd }, (_, index) => index),
    };
  }

  const firstFailureIndex = completed.findIndex((isComplete) => !isComplete);
  const processEnd = firstFailureIndex === -1 ? completed.length : firstFailureIndex;
  const processIndexes = Array.from({ length: processEnd }, (_, index) => index);

  return {
    processIndexes,
    restoreIndexes: Array.from({ length: completed.length - processEnd }, (_, index) => processEnd + index),
    frontierIndexes: processIndexes,
  };
}
