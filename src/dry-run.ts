import type { CapturedBatch, SummarizerStats } from "./types.js";

/** A non-mutating preview of pending work eligible for summarization. */
export interface DryRunPreview {
  batchCount: number;
  toolCallCount: number;
  rawCharCount: number;
  candidateBatchCount: number;
  candidateToolCallCount: number;
  candidateRawCharCount: number;
  skippedBatchCount: number;
  skippedRawCharCount: number;
  /** Derived from historical accepted summaries, when any exist. */
  estimatedSummaryCharCount?: number;
  estimatedSavingsCharCount?: number;
}

function batchRawCharCount(batch: CapturedBatch): number {
  return batch.toolCalls.reduce((total, toolCall) => total + toolCall.resultText.length, 0);
}

/**
 * Calculates pending-work totals without calling a provider or changing pruning state.
 * The estimate extrapolates from accepted historical summary compression only.
 */
export function calculateDryRunPreview(
  batches: readonly CapturedBatch[],
  minRawCharsThreshold: number,
  stats: SummarizerStats,
): DryRunPreview {
  let toolCallCount = 0;
  let rawCharCount = 0;
  let candidateBatchCount = 0;
  let candidateToolCallCount = 0;
  let candidateRawCharCount = 0;
  let skippedBatchCount = 0;
  let skippedRawCharCount = 0;

  for (const batch of batches) {
    const rawChars = batchRawCharCount(batch);
    toolCallCount += batch.toolCalls.length;
    rawCharCount += rawChars;
    const isSkipped = minRawCharsThreshold > 0 && rawChars <= minRawCharsThreshold;
    if (isSkipped) {
      skippedBatchCount += 1;
      skippedRawCharCount += rawChars;
    } else {
      candidateBatchCount += 1;
      candidateToolCallCount += batch.toolCalls.length;
      candidateRawCharCount += rawChars;
    }
  }

  const preview: DryRunPreview = {
    batchCount: batches.length,
    toolCallCount,
    rawCharCount,
    candidateBatchCount,
    candidateToolCallCount,
    candidateRawCharCount,
    skippedBatchCount,
    skippedRawCharCount,
  };
  if (stats.totalPrunedRawChars > 0) {
    const estimatedSummaryCharCount = Math.round(
      candidateRawCharCount * stats.totalPrunedSummaryChars / stats.totalPrunedRawChars,
    );
    preview.estimatedSummaryCharCount = estimatedSummaryCharCount;
    preview.estimatedSavingsCharCount = Math.max(0, candidateRawCharCount - estimatedSummaryCharCount);
  }
  return preview;
}
