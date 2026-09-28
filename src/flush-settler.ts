import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { DeferredSummaryCache } from "./deferred-summary-cache.js";
import { planFlushSettlement } from "./flush-settlement.js";
import { isSummarizeFailure, type FlushBatchExecution } from "./flush-batch-executor.js";
import { PruneFrontierTracker } from "./frontier.js";
import { SkippedOversizedTracker } from "./skipped-oversized.js";
import { ToolCallIndexer } from "./indexer.js";
import { StatsAccumulator } from "./stats.js";
import { formatSummaryToolCallRefs, makeSummaryDetails, wrapSummaryForContext } from "./summary-refs.js";
import type { CapturedBatch, ContextPruneConfig, FlushOptions, IndexEntryData, PruneFrontier, SummarizeResult } from "./types.js";
import { CUSTOM_TYPE_FRONTIER, CUSTOM_TYPE_INDEX, CUSTOM_TYPE_SUMMARY } from "./types.js";

export type FlushResult =
  | { ok: true; reason: "flushed" | "skipped-oversized" | "skipped-small" | "cancelled"; batchCount: number; toolCallCount: number; rawCharCount: number; summaryCharCount: number }
  | { ok: false; reason: "empty" | "already-flushing" | "summarizer-failed" | "stale-context" | "failed" | "aborted" | "cancelled"; error?: string };

export interface SessionAppender {
  appendCustomEntry(customType: string, data?: unknown): string;
  appendCustomMessageEntry(customType: string, content: string, display: boolean, details?: unknown): string;
}

interface FlushDelivery {
  pi: ExtensionAPI;
  mode: "runtime" | "session";
  sessionManager?: SessionAppender;
}

interface FlushSettlementState {
  indexer: ToolCallIndexer;
  frontier: PruneFrontierTracker;
  skippedOversized: SkippedOversizedTracker;
  stats: StatsAccumulator;
  deferredSummaries: DeferredSummaryCache<SummarizeResult>;
}

interface FlushSettlementLifecycle {
  restoreBatches: (batches: CapturedBatch[]) => void;
  persistStats: () => void;
  updateStatus: () => void;
  safeNotify: (message: string, type: "info" | "warning" | "error") => void;
  isStaleContextError: (error: unknown) => boolean;
  errorMessage: (error: unknown) => string;
}

interface SettleFlushOptions {
  delivery: FlushDelivery;
  state: FlushSettlementState;
  lifecycle: FlushSettlementLifecycle;
  config: ContextPruneConfig;
  flushOptions: FlushOptions;
  executions: FlushBatchExecution[];
  wasCancelled: boolean;
}

interface BatchMetric {
  toolCallCount: number;
  rawCharCount: number;
  summaryCharCount: number;
  small: boolean;
  oversized: boolean;
}

/** Commits completed batches, restores unfinished work, and advances only the contiguous frontier. */
export function settleFlushBatches(options: SettleFlushOptions): FlushResult {
  const { config, flushOptions, executions, wasCancelled } = options;
  const { pi, mode: delivery, sessionManager } = options.delivery;
  const { indexer, frontier, skippedOversized, stats, deferredSummaries } = options.state;
  const {
    restoreBatches, persistStats, updateStatus, safeNotify, isStaleContextError, errorMessage,
  } = options.lifecycle;
  const settlement = planFlushSettlement(
    executions.map(({ result }) => result !== null && !isSummarizeFailure(result)),
    wasCancelled,
  );
  // Determine the final rendered size for every completed batch before any
  // ordered commits: a later skip must survive even if an earlier write fails.
  const renderedSummaries = new Map<number, {
    summaryText: string;
    summaryRefs: ReturnType<ToolCallIndexer["allocateSummaryRefs"]>;
    oversized: boolean;
  }>();
  const skipWriteErrors: unknown[] = [];
  for (const [index, { batch, result, rawCharCount }] of executions.entries()) {
    if (!result || isSummarizeFailure(result) || "skippedSmall" in result) continue;
    let oversized: boolean;
    if ("skippedOversized" in result) {
      oversized = true;
    } else {
      const summaryRefs = indexer.allocateSummaryRefs(batch);
      const summaryText = wrapSummaryForContext(result.summaryText + formatSummaryToolCallRefs(summaryRefs));
      oversized = summaryText.length >= rawCharCount;
      renderedSummaries.set(index, { summaryText, summaryRefs, oversized });
    }
    if (!oversized) continue;
    try {
      skippedOversized.mark(batch, (type, data) => {
        if (delivery === "runtime") pi.appendEntry(type, data);
        else sessionManager!.appendCustomEntry(type, data);
      });
    } catch (error) {
      // One failed marker must not prevent other completed batches from being saved.
      skipWriteErrors.push(error);
    }
  }
  // Do not settle or claim an unrecorded skip; the caller restores pending work.
  if (skipWriteErrors.length > 0) throw skipWriteErrors[0];
  const processedBatches: CapturedBatch[] = [];
  const processedIndexes = new Set<number>();
  const batchMetrics = new Map<number, BatchMetric>();
  const oversizedExecutions: FlushBatchExecution[] = [];
  let totalRawCharCount = 0;
  let totalSummaryCharCount = 0;
  let totalToolCallCount = 0;
  let smallBatchCount = 0;
  let persistenceFailureIndex: number | undefined;

  const appendEntry = (customType: string, data?: unknown) => sessionManager!.appendCustomEntry(customType, data);
  const appendSummaryMessage = (content: string, details: unknown) =>
    sessionManager!.appendCustomMessageEntry(CUSTOM_TYPE_SUMMARY, content, false, details);

  for (const index of settlement.processIndexes) {
    const execution = executions[index];
    const { batch, result, rawCharCount } = execution;
    if (!result || isSummarizeFailure(result)) continue;
    if ("skippedSmall" in result) {
      totalRawCharCount += rawCharCount;
      totalToolCallCount += batch.toolCalls.length;
      smallBatchCount += 1;
      batchMetrics.set(index, metricFor(batch, rawCharCount, 0, true, false));
      processedBatches.push(batch);
      processedIndexes.add(index);
      continue;
    }

    if ("skippedOversized" in result) {
      totalRawCharCount += rawCharCount;
      totalSummaryCharCount += result.summaryCharCount;
      totalToolCallCount += batch.toolCalls.length;
      batchMetrics.set(index, metricFor(batch, rawCharCount, result.summaryCharCount, false, true));
      oversizedExecutions.push(execution);
      processedBatches.push(batch);
      processedIndexes.add(index);
      continue;
    }

    const { summaryRefs, summaryText, oversized } = renderedSummaries.get(index)!;
    totalRawCharCount += rawCharCount;
    totalSummaryCharCount += summaryText.length;
    totalToolCallCount += batch.toolCalls.length;
    batchMetrics.set(index, metricFor(batch, rawCharCount, summaryText.length, false, oversized));

    try {
      if (!oversized) {
        const details = makeSummaryDetails(batch, summaryRefs);
        if (delivery === "runtime") {
          pi.sendMessage(
            { customType: CUSTOM_TYPE_SUMMARY, content: summaryText, display: false, details },
            { deliverAs: "steer" },
          );
          indexer.registerSummaryRefs(summaryRefs);
          indexer.addBatch(batch, pi);
        } else {
          appendSummaryMessage(summaryText, details);
          indexer.registerSummaryRefs(summaryRefs);
          persistBatchIndex(batch, indexer, appendEntry);
        }
        stats.addPrunedChars(rawCharCount, summaryText.length);
      } else {
        oversizedExecutions.push(execution);
      }
    } catch (error) {
      if (isStaleContextError(error)) {
        persistenceFailureIndex = index;
        break;
      }
      throw error;
    }

    processedBatches.push(batch);
    processedIndexes.add(index);
  }

  restoreUnfinishedWork({
    settlementRestoreIndexes: settlement.restoreIndexes,
    persistenceFailureIndex,
    executions,
    processedIndexes,
    manual: flushOptions.onProgress !== undefined,
    deferredSummaries,
    skippedOversized,
    restoreBatches,
  });

  if (processedBatches.length === 0) {
    persistStats();
    updateStatus();
    return { ok: false, reason: wasCancelled ? "cancelled" : "summarizer-failed" };
  }

  const frontierIndexes = settlement.frontierIndexes.filter((index) => processedIndexes.has(index));
  if (frontierIndexes.length === 0) {
    persistStats();
    updateStatus();
    return {
      ok: true,
      reason: "cancelled",
      batchCount: processedBatches.length,
      toolCallCount: totalToolCallCount,
      rawCharCount: totalRawCharCount,
      summaryCharCount: totalSummaryCharCount,
    };
  }

  const frontierSnapshot = makeFrontierSnapshot(frontierIndexes, executions, batchMetrics);
  try {
    frontier.advance(frontierSnapshot);
    if (delivery === "runtime") frontier.persist(pi);
    else appendEntry(CUSTOM_TYPE_FRONTIER, frontierSnapshot);
  } catch (error) {
    return {
      ok: false,
      reason: isStaleContextError(error) ? "stale-context" : "failed",
      error: errorMessage(error),
    };
  }

  persistStats();
  updateStatus();
  notifyOversizedBatches(config, oversizedExecutions, safeNotify);

  return {
    ok: true,
    reason: wasCancelled
      ? "cancelled"
      : smallBatchCount === processedBatches.length
        ? "skipped-small"
        : oversizedExecutions.length === processedBatches.length
          ? "skipped-oversized"
          : "flushed",
    batchCount: processedBatches.length,
    toolCallCount: totalToolCallCount,
    rawCharCount: totalRawCharCount,
    summaryCharCount: totalSummaryCharCount,
  };
}

function metricFor(batch: CapturedBatch, rawCharCount: number, summaryCharCount: number, small: boolean, oversized: boolean): BatchMetric {
  return { toolCallCount: batch.toolCalls.length, rawCharCount, summaryCharCount, small, oversized };
}

function restoreUnfinishedWork(options: {
  settlementRestoreIndexes: number[];
  persistenceFailureIndex?: number;
  executions: FlushBatchExecution[];
  processedIndexes: Set<number>;
  manual: boolean;
  deferredSummaries: DeferredSummaryCache<SummarizeResult>;
  skippedOversized: SkippedOversizedTracker;
  restoreBatches: (batches: CapturedBatch[]) => void;
}): void {
  const isSkipped = (index: number) => options.executions[index].batch.toolCalls.every((call) => options.skippedOversized.isSkipped(call.toolCallId));
  const restoreIndexes = new Set(options.settlementRestoreIndexes.filter((index) => !isSkipped(index)));
  if (options.manual) {
    for (const index of restoreIndexes) {
      const { batch, result } = options.executions[index];
      if (result && !isSummarizeFailure(result) && !("skippedSmall" in result) && !("skippedOversized" in result)) {
        options.deferredSummaries.set(batch, result);
      }
    }
  }
  for (const index of options.processedIndexes) options.deferredSummaries.delete(options.executions[index].batch);
  if (options.persistenceFailureIndex !== undefined) {
    for (let index = options.persistenceFailureIndex; index < options.executions.length; index += 1) {
      if (!isSkipped(index)) restoreIndexes.add(index);
    }
  }
  options.restoreBatches([...restoreIndexes].sort((a, b) => a - b).map((index) => options.executions[index].batch));
}

function makeFrontierSnapshot(
  indexes: number[],
  executions: FlushBatchExecution[],
  metrics: Map<number, BatchMetric>,
): PruneFrontier {
  const frontierBatches = indexes.map((index) => executions[index].batch);
  const totals = indexes
    .map((index) => metrics.get(index)!)
    .reduce((sum, metric) => ({
      toolCallCount: sum.toolCallCount + metric.toolCallCount,
      rawCharCount: sum.rawCharCount + metric.rawCharCount,
      summaryCharCount: sum.summaryCharCount + metric.summaryCharCount,
      allSmall: sum.allSmall && metric.small,
      allOversized: sum.allOversized && metric.oversized,
    }), { toolCallCount: 0, rawCharCount: 0, summaryCharCount: 0, allSmall: true, allOversized: true });
  const lastBatch = frontierBatches[frontierBatches.length - 1];
  const lastToolCall = lastBatch.toolCalls[lastBatch.toolCalls.length - 1];
  return {
    lastAttemptedToolCallId: lastToolCall.toolCallId,
    lastAttemptedToolName: lastToolCall.toolName,
    lastAttemptedTurnIndex: lastBatch.turnIndex,
    lastAttemptedTimestamp: lastBatch.timestamp,
    attemptedBatchCount: frontierBatches.length,
    attemptedToolCallCount: totals.toolCallCount,
    rawCharCount: totals.rawCharCount,
    summaryCharCount: totals.summaryCharCount,
    outcome: totals.allSmall ? "skipped-small" : totals.allOversized ? "skipped-oversized" : "summarized",
  };
}

function persistBatchIndex(
  batch: CapturedBatch,
  indexer: ToolCallIndexer,
  appendEntry: (customType: string, data?: unknown) => void,
): void {
  const records = batch.toolCalls.map((toolCall) => ({
    toolCallId: toolCall.toolCallId,
    toolName: toolCall.toolName,
    args: toolCall.args,
    resultText: toolCall.resultText,
    isError: toolCall.isError,
    turnIndex: batch.turnIndex,
    timestamp: batch.timestamp,
  }));
  for (const record of records) indexer.getIndex().set(record.toolCallId, record);
  appendEntry(CUSTOM_TYPE_INDEX, { toolCalls: records } as IndexEntryData);
}

function notifyOversizedBatches(
  config: ContextPruneConfig,
  oversizedExecutions: FlushBatchExecution[],
  safeNotify: (message: string, type: "info" | "warning" | "error") => void,
): void {
  if (!config.notifySkipped) return;
  for (const { batch, result, rawCharCount } of oversizedExecutions) {
    let summaryChars = 0;
    if (result && !isSummarizeFailure(result)) {
      if ("skippedOversized" in result) summaryChars = result.summaryCharCount;
      else if (!("skippedSmall" in result)) summaryChars = result.summaryText.length;
    }
    safeNotify(
      `pruner: skipped pruning turn ${batch.turnIndex} (${batch.toolCalls.length} tool call${batch.toolCalls.length === 1 ? "" : "s"}) — summary was ${summaryChars} chars vs ${rawCharCount} raw chars; batch recorded as skipped`,
      "warning",
    );
  }
}
