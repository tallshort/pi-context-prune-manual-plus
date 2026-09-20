import type { CapturedBatch } from "./types.js";

/**
 * Process-local results that cannot yet be committed because an earlier batch
 * left a hole in the contiguous prune frontier.
 */
export class DeferredSummaryCache<T> {
  private readonly entries = new Map<string, T>();

  get(batch: CapturedBatch): T | undefined {
    return this.entries.get(batchKey(batch));
  }

  set(batch: CapturedBatch, summary: T): void {
    this.entries.set(batchKey(batch), summary);
  }

  delete(batch: CapturedBatch): void {
    this.entries.delete(batchKey(batch));
  }

  clear(): void {
    this.entries.clear();
  }
}

function batchKey(batch: CapturedBatch): string {
  return batch.toolCalls.map((toolCall) => toolCall.toolCallId).join("\u0000");
}
