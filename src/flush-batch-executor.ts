import { DeferredSummaryCache } from "./deferred-summary-cache.js";
import { runAbortableBounded, runWithOneRetry } from "./manual-prune-scheduler.js";
import { shouldSkipMinRawCharsThreshold } from "./min-raw-chars-threshold.js";
import { summarizeBatch, summarizeBatches, waitForSummarizerCooldown } from "./summarizer.js";
import { StatsAccumulator } from "./stats.js";
import type {
  CapturedBatch,
  ContextPruneConfig,
  FlushOptions,
  SummarizeFailure,
  SummarizeResult,
  SummarizeSkippedOversized,
} from "./types.js";

export type FlushBatchResult = SummarizeResult | SummarizeFailure | SummarizeSkippedOversized | { skippedSmall: true } | null;

export interface FlushBatchExecution {
  batch: CapturedBatch;
  result: FlushBatchResult;
  rawCharCount: number;
}

export function isSummarizeFailure(result: FlushBatchResult): result is SummarizeFailure {
  return result !== null && "failureKind" in result;
}

interface ExecuteFlushBatchesOptions {
  batches: CapturedBatch[];
  getConfig: () => ContextPruneConfig;
  ctx: any;
  flushOptions: FlushOptions;
  deferredSummaries: DeferredSummaryCache<SummarizeResult>;
  stats: StatsAccumulator;
  onUsage: (batch: CapturedBatch, response: import("@earendil-works/pi-ai").AssistantMessage) => void;
}

/** Executes provider work while preserving automatic hard-abort and manual soft-cancel semantics. */
export async function executeFlushBatches({
  batches,
  getConfig,
  ctx,
  flushOptions,
  deferredSummaries,
  stats,
  onUsage,
}: ExecuteFlushBatchesOptions): Promise<{ executions: FlushBatchExecution[]; wasCancelled: boolean }> {
  const executions: FlushBatchExecution[] = batches.map((batch) => ({
    batch,
    rawCharCount: batch.toolCalls.reduce((total, toolCall) => total + toolCall.resultText.length, 0),
    result: null,
  }));
  const reportTextProgress = (index: number, total: number, batch: CapturedBatch, receivedChars: number) => {
    flushOptions.onBatchTextProgress?.(index, total, batch, receivedChars);
  };

  if (flushOptions.onProgress) {
    await executeManualBatches({
      executions,
      getConfig,
      ctx,
      flushOptions,
      deferredSummaries,
      stats,
      onUsage,
      reportTextProgress,
    });
  } else {
    const eligible: FlushBatchExecution[] = [];
    for (const execution of executions) {
      if (shouldSkipMinRawCharsThreshold(execution.rawCharCount, getConfig().minRawCharsThreshold)) {
        execution.result = { skippedSmall: true };
      } else {
        eligible.push(execution);
      }
    }
    const summarizedResults = eligible.length === 0
      ? []
      : await summarizeBatches(eligible.map(({ batch }) => batch), getConfig(), ctx, {
          onBatchTextProgress: reportTextProgress,
          onUsage,
          onSoftRetry: () => stats.addRetry(),
          signal: flushOptions.signal,
        });
    eligible.forEach((execution, index) => {
      execution.result = summarizedResults[index];
    });
    for (const { result } of executions) {
      if (isSummarizeFailure(result)) stats.addFinalFailure(result.failureKind);
    }
  }

  return { executions, wasCancelled: flushOptions.signal?.aborted === true };
}

interface ManualExecutionOptions extends Omit<ExecuteFlushBatchesOptions, "batches"> {
  executions: FlushBatchExecution[];
  reportTextProgress: (index: number, total: number, batch: CapturedBatch, receivedChars: number) => void;
}

async function executeManualBatches({
  executions,
  getConfig,
  ctx,
  flushOptions,
  deferredSummaries,
  stats,
  onUsage,
  reportTextProgress,
}: ManualExecutionOptions): Promise<void> {
  await runAbortableBounded(
    executions,
    getConfig().manualPruneConcurrency,
    flushOptions.signal,
    async (execution, index) => {
      const { batch, rawCharCount } = execution;
      if (shouldSkipMinRawCharsThreshold(rawCharCount, getConfig().minRawCharsThreshold)) {
        flushOptions.onProgress!(index, executions.length, batch, "skipped");
        execution.result = { skippedSmall: true };
        return execution.result;
      }

      const cached = deferredSummaries.get(batch);
      if (cached) {
        flushOptions.onProgress!(index, executions.length, batch, "start", { attempts: 0, retryCount: 0 });
        flushOptions.onProgress!(index, executions.length, batch, "done", { attempts: 0, retryCount: 0 });
        execution.result = cached;
        return cached;
      }

      let attempts = 0;
      let softRetries = 0;
      const attempt = async () => {
        attempts += 1;
        flushOptions.onProgress!(index, executions.length, batch, "start", { attempts: attempts + softRetries, retryCount: attempts + softRetries - 1 });
        return summarizeBatch(batch, getConfig(), ctx, {
          // Manual cancellation is soft: already-started provider calls finish.
          signal: undefined,
          onUsage: (response) => onUsage(batch, response),
          notifyOnFailure: false,
          onSoftRetry: () => {
            if (flushOptions.signal?.aborted) return false;
            stats.addRetry();
            softRetries++;
            flushOptions.onProgress!(index, executions.length, batch, "retry", {
              attempts: attempts + softRetries - 1,
              retryCount: attempts + softRetries - 1,
              failureKind: "provider",
              failureMessage: "summary exceeded 4,000 characters — retrying concisely",
            });
            flushOptions.onProgress!(index, executions.length, batch, "start", {
              attempts: attempts + softRetries,
              retryCount: attempts + softRetries - 1,
            });
            return true;
          },
          onTextProgress: (receivedChars) => reportTextProgress(index, executions.length, batch, receivedChars),
        });
      };

      const retry = await runWithOneRetry(attempt, async (result) => {
        if (!isSummarizeFailure(result) || !result.retryable || flushOptions.signal?.aborted) return false;
        flushOptions.onProgress!(index, executions.length, batch, "retry", {
          attempts: attempts + softRetries,
          retryCount: attempts + softRetries,
          failureKind: result.failureKind,
          failureMessage: result.failureMessage,
        });
        if (result.failureKind !== "rate-limit") return true;
        return waitForSummarizerCooldown(flushOptions.signal, (remainingMs) => {
          flushOptions.onProgress!(index, executions.length, batch, "retry", {
            attempts: attempts + softRetries,
            retryCount: attempts + softRetries,
            failureKind: result.failureKind,
            failureMessage: `rate limited — retrying in ${Math.ceil(remainingMs / 1_000)}s`,
          });
        });
      }, flushOptions.signal, () => stats.addRetry());

      execution.result = retry.value;
      if ("skippedOversized" in execution.result) {
        flushOptions.onProgress!(index, executions.length, batch, "skipped");
      } else if (isSummarizeFailure(execution.result)) {
        stats.addFinalFailure(execution.result.failureKind);
        flushOptions.onProgress!(index, executions.length, batch, "failed", {
          attempts: retry.attempts + softRetries,
          retryCount: retry.retryCount + softRetries,
          failureKind: execution.result.failureKind,
          failureMessage: execution.result.failureMessage,
        });
      } else {
        flushOptions.onProgress!(index, executions.length, batch, "done", {
          attempts: retry.attempts + softRetries,
          retryCount: retry.retryCount + softRetries,
        });
      }
      return execution.result;
    },
  );
}
