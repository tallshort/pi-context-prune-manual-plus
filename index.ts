/**
 * context-prune — Pi extension entry point
 *
 * Wires together all modules:
 *   config       — load/save ~/.pi/agent/context-prune/settings.json
 *   batch-capture — serialize turn_end event into CapturedBatch
 *   summarizer   — call LLM to summarize a CapturedBatch
 *   indexer      — maintain Map<toolCallId, ToolCallRecord> + session persistence
 *   pruner       — filter context event messages
 *   query-tool   — register context_tree_query tool
 *   commands     — register /pruner command + message renderer
 *
 * Usage:  pi -e .
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadConfig } from "./src/config.js";
import { captureBatch, captureUnindexedBatchesFromSession, groupBatchesByMode } from "./src/batch-capture.js";
import { summarizeBatch, summarizeBatches } from "./src/summarizer.js";
import { runAbortableBounded, runWithOneRetry } from "./src/manual-prune-scheduler.js";
import { planFlushSettlement } from "./src/flush-settlement.js";
import { DeferredSummaryCache } from "./src/deferred-summary-cache.js";
import { shouldSkipMinRawCharsThreshold } from "./src/min-raw-chars-threshold.js";
import { ToolCallIndexer } from "./src/indexer.js";
import { pruneMessages } from "./src/pruner.js";
import { annotateWithUnprunedCount, countUnprunedToolCalls } from "./src/reminder.js";
import { registerQueryTool } from "./src/query-tool.js";
import { registerCommands, pruneStatusText, setPruneStatusWidget } from "./src/commands.js";
import { formatSummaryToolCallRefs, makeSummaryDetails, wrapSummaryForContext } from "./src/summary-refs.js";
import type { ContextPruneConfig, CapturedBatch, IndexEntryData, PruneFrontier, FlushOptions, SummarizeResult, SummarizeFailure } from "./src/types.js";
import {
  DEFAULT_CONFIG,
  CONTEXT_PRUNE_TOOL_NAME,
  CONTEXT_TAG_TOOL_NAMES,
  AGENTIC_AUTO_SYSTEM_PROMPT,
  CUSTOM_TYPE_SUMMARY,
  CUSTOM_TYPE_INDEX,
  CUSTOM_TYPE_STATS,
  CUSTOM_TYPE_FRONTIER,
} from "./src/types.js";
import { StatsAccumulator } from "./src/stats.js";
import { registerContextPruneTool } from "./src/context-prune-tool.js";
import { PruneFrontierTracker } from "./src/frontier.js";

export default function (pi: ExtensionAPI) {
  // Shared mutable config reference — updated by /pruner commands
  const currentConfig: { value: ContextPruneConfig } = {
    value: { ...DEFAULT_CONFIG, pruneOn: "every-turn" },
  };

  // Shared indexer — rebuilt from session on every session_start / session_tree
  const indexer = new ToolCallIndexer();

  // Shared stats accumulator — tracks cumulative token/cost stats for summarizer calls
  const statsAccum = new StatsAccumulator();

  // Shared prune frontier — tracks the last completed prune attempt boundary
  const frontier = new PruneFrontierTracker();

  // Pending batches — accumulated until the prune trigger fires
  const pendingBatches: CapturedBatch[] = [];
  let isFlushing = false;
  // Successful batches behind a failed earlier batch remain reusable for this
  // extension process only. They are never indexed or pruned until settlement
  // later reaches them contiguously.
  const deferredSummaries = new DeferredSummaryCache<SummarizeResult>();

  type FlushResult =
    | { ok: true; reason: "flushed" | "skipped-oversized" | "skipped-small" | "cancelled"; batchCount: number; toolCallCount: number; rawCharCount: number; summaryCharCount: number }
    | { ok: false; reason: "empty" | "already-flushing" | "summarizer-failed" | "stale-context" | "failed" | "aborted" | "cancelled"; error?: string };

  type SessionAppender = {
    appendCustomEntry(customType: string, data?: unknown): string;
    appendCustomMessageEntry(customType: string, content: string, display: boolean, details?: unknown): string;
  };

  const isStaleContextError = (err: unknown) =>
    err instanceof Error && err.message.includes("This extension ctx is stale");

  const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

  const safeNotify = (ctx: any, message: string, type: "info" | "warning" | "error" = "info") => {
    try {
      ctx.ui.notify(message, type);
    } catch (err) {
      if (!isStaleContextError(err)) throw err;
    }
  };

  const assistantMessageHasToolCalls = (message: any) =>
    message?.role === "assistant" &&
    Array.isArray(message.content) &&
    message.content.some((block: any) => block?.type === "toolCall");

  const isFinalAssistantMessage = (message: any) => message?.role === "assistant" && !assistantMessageHasToolCalls(message);

  const trimBatchToPendingRange = (batch: CapturedBatch): CapturedBatch | null => {
    const currentFrontier = frontier.get();
    let toolCalls = batch.toolCalls;

    // The indexer tells us what was successfully summarized earlier.
    toolCalls = toolCalls.filter((tc) => !indexer.isSummarized(tc.toolCallId));
    if (toolCalls.length === 0) return null;

    // The frontier tells us the last attempted boundary even when the attempt did
    // not persist index entries (e.g. skipped-oversized). When the LLM prunes in
    // the middle of a long tool chain, keep later tool calls from the same turn
    // instead of dropping the whole batch on the floor.
    if (!currentFrontier) return { ...batch, toolCalls };
    if (batch.turnIndex < currentFrontier.lastAttemptedTurnIndex) return null;
    if (batch.turnIndex > currentFrontier.lastAttemptedTurnIndex) return { ...batch, toolCalls };

    const originalIndex = toolCalls.findIndex((tc) => tc.toolCallId === currentFrontier.lastAttemptedToolCallId);
    if (originalIndex < 0) return { ...batch, toolCalls };

    const remaining = toolCalls.slice(originalIndex + 1);
    if (remaining.length === 0) return null;
    return { ...batch, toolCalls: remaining };
  };

  const restoreBatches = (batches: CapturedBatch[]) => {
    pendingBatches.unshift(...batches);
  };

  const persistBatchIndex = (batch: CapturedBatch, appendEntry: (customType: string, data?: unknown) => void) => {
    const records = batch.toolCalls.map((tc) => ({
      toolCallId: tc.toolCallId,
      toolName: tc.toolName,
      args: tc.args,
      resultText: tc.resultText,
      isError: tc.isError,
      turnIndex: batch.turnIndex,
      timestamp: batch.timestamp,
    }));

    for (const record of records) {
      indexer.getIndex().set(record.toolCallId, record);
    }

    appendEntry(CUSTOM_TYPE_INDEX, { toolCalls: records } as IndexEntryData);
  };

  // ── Helper: capture + trim + group pending batches (no LLM work) ──────────
  // Exposed to commands.ts via registerCommands so /pruner now can preview the
  // queue before opening the multi-row progress overlay.
  const capturePendingBatches = (ctx: any): CapturedBatch[] => {
    let batches: CapturedBatch[] = [];
    try {
      const branch = ctx.sessionManager.getBranch();
      batches = captureUnindexedBatchesFromSession(branch, indexer, [CONTEXT_PRUNE_TOOL_NAME]);
    } catch {
      batches = pendingBatches.slice();
    }
    batches = batches
      .map((batch) => trimBatchToPendingRange(batch))
      .filter((batch): batch is CapturedBatch => batch !== null);
    return groupBatchesByMode(batches, currentConfig.value.batchingMode);
  };

  // Summarizes + indexes all pending batches.
  // Summarizes + indexes all pending batches. `/pruner now` uses bounded
  // concurrency so callers can update per-row UI; other paths summarize in parallel.
  // Runtime delivery is used while the agent/tool loop is active so Pi can place
  // steer messages at protocol-safe boundaries. Session delivery is used only for
  // agent-message's final-message flush, where print-mode Pi may invalidate pi.*
  // while the summarizer LLM call is in flight.
  const flushPending = async (ctx: any, options: FlushOptions = {}): Promise<FlushResult> => {
    if (isFlushing) return { ok: false, reason: "already-flushing" };

    // Use pre-captured batches if provided (avoids double-capture when the
    // caller previewed the queue before opening the progress overlay).
    let batches: CapturedBatch[] = options.previewedBatches ?? capturePendingBatches(ctx);

    if (batches.length === 0) return { ok: false, reason: "empty" };

    // Bail out before we drain pendingBatches so they don't need restoring.
    if (options.signal?.aborted) return { ok: false, reason: "aborted" };

    // Draining the queue since we've captured the state via session or slice.
    // We drain BEFORE the await so concurrent calls (though guarded by isFlushing)
    // or rapid turn-ends don't result in double-summarization.
    pendingBatches.length = 0;

    isFlushing = true;

    const delivery = options.delivery ?? "runtime";
    let sessionManager: SessionAppender | undefined;
    if (delivery === "session") {
      try {
        sessionManager = ctx.sessionManager as unknown as SessionAppender;
      } catch (err) {
        restoreBatches(batches);
        isFlushing = false;
        return { ok: false, reason: isStaleContextError(err) ? "stale-context" : "failed", error: errorMessage(err) };
      }
    }

    const appendEntry = (customType: string, data?: unknown) => sessionManager!.appendCustomEntry(customType, data);
    const appendSummaryMessage = (content: string, details: unknown) =>
      sessionManager!.appendCustomMessageEntry(CUSTOM_TYPE_SUMMARY, content, false, details);

    try {
      setPruneStatusWidget(ctx, currentConfig.value, "prune: summarizing…");

      const reportBatchTextProgress = (index: number, total: number, batch: CapturedBatch, receivedChars: number) => {
        options.onBatchTextProgress?.(index, total, batch, receivedChars);
      };
      const isSmallBatch = (batch: CapturedBatch) =>
        shouldSkipMinRawCharsThreshold(
          batch.toolCalls.reduce((total, toolCall) => total + toolCall.resultText.length, 0),
          currentConfig.value.minRawCharsThreshold,
        );
      type BatchResult = SummarizeResult | SummarizeFailure | { skippedSmall: true } | null;
      const isFailure = (result: BatchResult): result is SummarizeFailure =>
        result !== null && "failureKind" in result;
      // `/pruner now` reports individual row state. Limit its concurrent calls so the
      // widget remains responsive without overwhelming the summarizer provider.
      // Other flush paths run fully parallel below.
      let results: BatchResult[];
      if (options.onProgress) {
        results = await runAbortableBounded(
          batches,
          currentConfig.value.manualPruneConcurrency,
          options.signal,
          async (batch, index) => {
            if (isSmallBatch(batch)) {
              options.onProgress!(index, batches.length, batch, "skipped");
              return { skippedSmall: true as const };
            }
            const cached = deferredSummaries.get(batch);
            if (cached) {
              options.onProgress!(index, batches.length, batch, "start", { attempts: 0, retryCount: 0 });
              options.onProgress!(index, batches.length, batch, "done", { attempts: 0, retryCount: 0 });
              return cached;
            }
            let attempts = 0;
            const attempt = async () => {
              attempts += 1;
              options.onProgress!(index, batches.length, batch, "start", { attempts, retryCount: attempts - 1 });
              return summarizeBatch(batch, currentConfig.value, ctx, {
                // Manual cancellation is soft: finish already-started calls so their
                // completed summaries can still be indexed, but do not start another.
                signal: undefined,
                notifyOnFailure: false,
                onTextProgress: (receivedChars) => reportBatchTextProgress(index, batches.length, batch, receivedChars),
              });
            };
            const retry = await runWithOneRetry(attempt, (result) => {
              if (!isFailure(result) || !result.retryable || options.signal?.aborted) return false;
              statsAccum.addRetry();
              options.onProgress!(index, batches.length, batch, "retry", {
                attempts: 1,
                retryCount: 1,
                failureKind: result.failureKind,
                failureMessage: result.failureMessage,
              });
              return true;
            });
            const result = retry.value;
            if (isFailure(result)) {
              statsAccum.addFinalFailure(result.failureKind);
              options.onProgress!(index, batches.length, batch, "failed", {
                attempts: retry.attempts,
                retryCount: retry.retryCount,
                failureKind: result.failureKind,
                failureMessage: result.failureMessage,
              });
            } else {
              options.onProgress!(index, batches.length, batch, "done", { attempts: retry.attempts, retryCount: retry.retryCount });
            }
            return result;
          },
        );
      } else {
        const batchesToSummarize = batches.filter((batch) => !isSmallBatch(batch));
        const summarizedResults = batchesToSummarize.length === 0
          ? []
          : await summarizeBatches(batchesToSummarize, currentConfig.value, ctx, {
              onBatchTextProgress: reportBatchTextProgress,
              signal: options.signal,
            });
        let summarizedIndex = 0;
        results = batches.map((batch) =>
          isSmallBatch(batch) ? { skippedSmall: true } : summarizedResults[summarizedIndex++],
        );
      }
      const wasCancelled = options.signal?.aborted === true;

      // Structured failures are restored below; record aggregate categories only.
      if (!options.onProgress) {
        for (const result of results) if (isFailure(result)) statsAccum.addFinalFailure(result.failureKind);
      }
      const settlement = planFlushSettlement(results.map((result) => result !== null && !isFailure(result)), wasCancelled);
      const processedBatches: CapturedBatch[] = [];
      const processedIndexes = new Set<number>();
      let totalRawCharCount = 0;
      let totalSummaryCharCount = 0;
      let totalToolCallCount = 0;
      const oversizedBatches: CapturedBatch[] = [];
      let smallBatchCount = 0;
      let persistenceFailureIndex: number | undefined;

      for (const i of settlement.processIndexes) {
        const result = results[i];
        const batch = batches[i];
        if (!result || isFailure(result)) continue;
        const batchRawCharCount = batch.toolCalls.reduce((s, tc) => s + tc.resultText.length, 0);
        if ("skippedSmall" in result) {
          totalRawCharCount += batchRawCharCount;
          totalToolCallCount += batch.toolCalls.length;
          smallBatchCount += 1;
          processedBatches.push(batch);
          processedIndexes.add(i);
          continue;
        }

        const summaryRefs = indexer.allocateSummaryRefs(batch);
        const summaryText = wrapSummaryForContext(result.summaryText + formatSummaryToolCallRefs(summaryRefs));
        const shouldSkipOversized = summaryText.length > batchRawCharCount;
        statsAccum.add(result.usage);
        totalRawCharCount += batchRawCharCount;
        totalSummaryCharCount += summaryText.length;
        totalToolCallCount += batch.toolCalls.length;

        const batchDetails = makeSummaryDetails(batch, summaryRefs);

        try {
          if (!shouldSkipOversized) {
            // Write one hidden summary message per turn and index its tool calls.
            // `display: false` keeps the summary in future LLM context and session
            // history without printing the full markdown block into Pi's main window.
            if (delivery === "runtime") {
              pi.sendMessage(
                { customType: CUSTOM_TYPE_SUMMARY, content: summaryText, display: false, details: batchDetails },
                { deliverAs: "steer" }
              );
              indexer.registerSummaryRefs(summaryRefs);
              indexer.addBatch(batch, pi);
            } else {
              appendSummaryMessage(summaryText, batchDetails);
              indexer.registerSummaryRefs(summaryRefs);
              persistBatchIndex(batch, appendEntry);
            }
            statsAccum.addPrunedChars(batchRawCharCount, summaryText.length);
          } else {
            oversizedBatches.push(batch);
          }
        } catch (err) {
          // Persistence error mid-loop: restore this and later batches.
          if (isStaleContextError(err)) {
            persistenceFailureIndex = i;
            break;
          }
          throw err;
        }

        processedBatches.push(batch);
        processedIndexes.add(i);
      }

      // Restore planner-selected work plus the failed persistence range, if any.
      // This preserves retry behavior when session persistence becomes stale.
      const restoreIndexes = new Set(settlement.restoreIndexes);
      // Keep provider-successful manual batches behind a hole for a later
      // contiguous settlement. The cache is process-local and is cleared when
      // session state is reconstructed.
      if (options.onProgress) {
        for (const index of restoreIndexes) {
          const result = results[index];
          if (result && !isFailure(result) && !("skippedSmall" in result)) {
            deferredSummaries.set(batches[index], result);
          }
        }
      }
      for (const index of processedIndexes) deferredSummaries.delete(batches[index]);
      if (persistenceFailureIndex !== undefined) {
        for (let i = persistenceFailureIndex; i < batches.length; i++) restoreIndexes.add(i);
      }
      restoreBatches([...restoreIndexes].sort((a, b) => a - b).map((index) => batches[index]));

      if (processedBatches.length === 0) {
        // Retry/failure counters are durable even when no batch produced a summary.
        try {
          if (delivery === "runtime") statsAccum.persist(pi);
          else appendEntry(CUSTOM_TYPE_STATS, statsAccum.getStats());
        } catch {
          // Session/index persistence failures stay pending and are never retried here.
        }
        setPruneStatusWidget(ctx, currentConfig.value, statsAccum.getStats());
        return { ok: false, reason: wasCancelled ? "cancelled" : "summarizer-failed" };
      }

      // The settlement planner limits the frontier to the contiguous completed
      // prefix after cancellation. A persistence error can shorten it further.
      const frontierBatches = settlement.frontierIndexes
        .filter((index) => processedIndexes.has(index))
        .map((index) => batches[index]);
      const allOversized = oversizedBatches.length === processedBatches.length;
      const allSmall = smallBatchCount === processedBatches.length;
      if (frontierBatches.length === 0) {
        // Completed batches may be indexed behind a cancellation hole. Their
        // frontier cannot advance yet, but their cumulative stats are durable.
        try {
          if (delivery === "runtime") statsAccum.persist(pi);
          else appendEntry(CUSTOM_TYPE_STATS, statsAccum.getStats());
        } catch {
          // Keep the existing cancellation result even if stats persistence fails.
        }
        setPruneStatusWidget(ctx, currentConfig.value, statsAccum.getStats());
        return {
          ok: true,
          reason: "cancelled",
          batchCount: processedBatches.length,
          toolCallCount: totalToolCallCount,
          rawCharCount: totalRawCharCount,
          summaryCharCount: totalSummaryCharCount,
        };
      }
      const lastBatch = frontierBatches[frontierBatches.length - 1];
      const lastTC = lastBatch.toolCalls[lastBatch.toolCalls.length - 1];
      const frontierSnapshot: PruneFrontier = {
        lastAttemptedToolCallId: lastTC.toolCallId,
        lastAttemptedToolName: lastTC.toolName,
        lastAttemptedTurnIndex: lastBatch.turnIndex,
        lastAttemptedTimestamp: lastBatch.timestamp,
        attemptedBatchCount: frontierBatches.length,
        attemptedToolCallCount: totalToolCallCount,
        rawCharCount: totalRawCharCount,
        summaryCharCount: totalSummaryCharCount,
        outcome: allSmall ? "skipped-small" : allOversized ? "skipped-oversized" : "summarized",
      };

      try {
        if (delivery === "runtime") {
          frontier.advance(frontierSnapshot);
          frontier.persist(pi);
          statsAccum.persist(pi);
        } else {
          frontier.advance(frontierSnapshot);
          appendEntry(CUSTOM_TYPE_FRONTIER, frontierSnapshot);
          try {
            appendEntry(CUSTOM_TYPE_STATS, statsAccum.getStats());
          } catch {
            // Ignore stats persistence failures; the prune result and frontier are the contract.
          }
        }
      } catch (err) {
        return { ok: false, reason: isStaleContextError(err) ? "stale-context" : "failed", error: errorMessage(err) };
      }

      setPruneStatusWidget(ctx, currentConfig.value, statsAccum.getStats());

      // Respect notifySkipped for both automatic flushes and /pruner now.
      if (currentConfig.value.notifySkipped) {
        for (const batch of oversizedBatches) {
          const batchRaw = batch.toolCalls.reduce((s, tc) => s + tc.resultText.length, 0);
          const batchResult = results[batches.indexOf(batch)];
          const batchSummaryLen = batchResult && !("skippedSmall" in batchResult) ? batchResult.summaryText.length : 0;
          safeNotify(
            ctx,
            `pruner: skipped pruning turn ${batch.turnIndex} (${batch.toolCalls.length} tool call${batch.toolCalls.length === 1 ? "" : "s"}) — summary was ${batchSummaryLen} chars vs ${batchRaw} raw chars; frontier advanced past this range`,
            "warning"
          );
        }
      }

      return {
        ok: true,
        reason: wasCancelled ? "cancelled" : allSmall ? "skipped-small" : allOversized ? "skipped-oversized" : "flushed",
        batchCount: processedBatches.length,
        toolCallCount: totalToolCallCount,
        rawCharCount: totalRawCharCount,
        summaryCharCount: totalSummaryCharCount,
      };
    } catch (err) {
      restoreBatches(batches);
      // When the abort signal fired, summarizeBatch rethrows rather than
      // swallowing the error.  Don't show a UI error — the user intended this.
      if (options.signal?.aborted) {
        setPruneStatusWidget(ctx, currentConfig.value, statsAccum.getStats());
        return { ok: false, reason: "aborted" };
      }
      if (isStaleContextError(err)) {
        return { ok: false, reason: "stale-context", error: errorMessage(err) };
      }
      safeNotify(ctx, `pruner: summarization failed: ${errorMessage(err)}`, "error");
      return { ok: false, reason: "failed", error: errorMessage(err) };
    } finally {
      isFlushing = false;
    }
  };

  // ── Helper: toggle context_prune tool activation based on config ───────────
  // Uses `pi` (ExtensionRuntime) because getActiveTools/setActiveTools are
  // runtime methods, NOT part of ExtensionContext/ExtensionCommandContext.
  const syncToolActivation = () => {
    const shouldActivate = currentConfig.value.enabled && currentConfig.value.pruneOn === "agentic-auto";
    const activeTools = pi.getActiveTools();
    if (shouldActivate) {
      if (!activeTools.includes(CONTEXT_PRUNE_TOOL_NAME)) {
        pi.setActiveTools([...activeTools, CONTEXT_PRUNE_TOOL_NAME]);
      }
    } else {
      if (activeTools.includes(CONTEXT_PRUNE_TOOL_NAME)) {
        pi.setActiveTools(activeTools.filter((t: string) => t !== CONTEXT_PRUNE_TOOL_NAME));
      }
    }
  };

  // ── session_start: restore config + index + stats ────────────────────────────────
  pi.on("session_start", async (_event, ctx) => {
    // Load config from ~/.pi/agent/context-prune/settings.json
    currentConfig.value = await loadConfig();

    // Rebuild in-memory index from persisted session entries
    indexer.reconstructFromSession(ctx);

    // Rebuild stats accumulator from persisted session entries
    statsAccum.reconstructFromSession(ctx);

    // Rebuild prune frontier from persisted session entries
    frontier.reconstructFromSession(ctx);

    // Clear any batches queued before the session reload
    pendingBatches.length = 0;
    deferredSummaries.clear();

    // Update footer status
    setPruneStatusWidget(ctx, currentConfig.value, statsAccum.getStats());

    // Toggle context_prune tool activation for agentic-auto mode
    syncToolActivation();

    if (currentConfig.value.showStartupNotice) {
      ctx.ui.notify(
        `pruner loaded — pruning ${currentConfig.value.enabled ? "ON" : "OFF"} | model: ${currentConfig.value.summarizerModel}`,
        "info"
      );
    }
  });

  // Rebuild index and stats after tree navigation too (branch may have different history)
  pi.on("session_tree", async (_event, ctx) => {
    indexer.reconstructFromSession(ctx);
    statsAccum.reconstructFromSession(ctx);
    frontier.reconstructFromSession(ctx);
    // Pending batches belong to the old branch — discard them
    pendingBatches.length = 0;
    deferredSummaries.clear();
  });

  // ── turn_end: capture batch, flush immediately or queue ──────────────────
  pi.on("turn_end", async (event, ctx) => {
    if (!currentConfig.value.enabled) return;

    const hasToolResults = event.toolResults && event.toolResults.length > 0;

    if (!hasToolResults) {
      // Text-only final turns are handled by message_end in agent-message mode.
      // In print mode, turn_end can fire after session shutdown, so do not start
      // deferred LLM work from this late lifecycle event.
      return;
    }

    const capturedBatch = captureBatch(
      event.message,
      event.toolResults,
      event.turnIndex,
      Date.now()
    );
    const batch = trimBatchToPendingRange({
      ...capturedBatch,
      // Do not summarize the pruner's own housekeeping tool result. Otherwise
      // agentic-auto mode can queue the context_prune result and try to flush it
      // during agent_end, when Pi may already have invalidated the extension ctx.
      toolCalls: capturedBatch.toolCalls.filter((tc) => tc.toolName !== CONTEXT_PRUNE_TOOL_NAME),
    });
    if (!batch) return;

    pendingBatches.push(batch);

    if (currentConfig.value.pruneOn === "every-turn") {
      await flushPending(ctx, { delivery: "session" });
    } else {
      const n = pendingBatches.length;
      if (currentConfig.value.showPruneStatusLine) {
        const statusText = currentConfig.value.pruneOn === "on-demand"
          ? pruneStatusText(currentConfig.value, statsAccum.getStats(), capturePendingBatches(ctx).length)
          : `prune: ${n} pending`;
        setPruneStatusWidget(ctx, currentConfig.value, statusText);
      }
    }
  });

  // ── tool_execution_end: flush when context_checkpoint (or legacy context_tag) fires ──
  pi.on("tool_execution_end", async (event, ctx) => {
    if (!(CONTEXT_TAG_TOOL_NAMES as readonly string[]).includes(event.toolName)) return;
    if (!currentConfig.value.enabled) return;
    if (currentConfig.value.pruneOn !== "on-context-tag") return;
    await flushPending(ctx, { delivery: "runtime" });
  });

  // ── message_end: flush after the final assistant response in agent-message mode ──
  // A final assistant message is the earliest reliable boundary where the agent has
  // finished using the raw tool results. flushPending captures the SessionManager
  // before awaiting summarization so print-mode shutdown cannot invalidate the
  // persistence path while the summarizer model is running.
  pi.on("message_end", async (event, ctx) => {
    if (!currentConfig.value.enabled) return;
    if (currentConfig.value.pruneOn !== "agent-message") return;
    if (!isFinalAssistantMessage(event.message)) return;
    await flushPending(ctx, { delivery: "session" });
  });

  // ── agent_end: last-chance cleanup only ─────────────────────────────────────
  // agent-message normally flushes on message_end. By agent_end, print-mode Pi may
  // already be disposing the session, so avoid starting a best-effort LLM call here.
  pi.on("agent_end", async (_event, ctx) => {
    if (!currentConfig.value.enabled) return;
    if (currentConfig.value.pruneOn === "on-demand") {
      const pendingCount = capturePendingBatches(ctx).length;
      setPruneStatusWidget(ctx, currentConfig.value, pruneStatusText(currentConfig.value, statsAccum.getStats(), pendingCount));
      return;
    }
    if (pendingBatches.length === 0) return;
    setPruneStatusWidget(ctx, currentConfig.value, `prune: ${pendingBatches.length} pending`);
  });

  // ── context: prune summarized tool results from next LLM call ─────────────
  pi.on("context", async (event, _ctx) => {
    if (!currentConfig.value.enabled) return undefined;

    const indexEmpty = indexer.getIndex().size === 0;
    let messages = event.messages;
    let changed = false;

    if (!indexEmpty) {
      const pruned = pruneMessages(messages, indexer);
      if (pruned.length !== messages.length) {
        messages = pruned;
        changed = true;
      }
    }

    // Append a small `<pruner-note>` to the last toolResult telling the model
    // how many unpruned tool calls are sitting in context. Only active in
    // agentic-auto mode (where the LLM itself decides when to call
    // context_prune) and only when the user has the reminder enabled.
    if (
      currentConfig.value.pruneOn === "agentic-auto" &&
      currentConfig.value.remindUnprunedCount
    ) {
      const count = countUnprunedToolCalls(messages, indexer);
      if (count > 0) {
        const annotated = annotateWithUnprunedCount(messages, count);
        if (annotated !== messages) {
          messages = annotated;
          changed = true;
        }
      }
    }

    if (!changed) return undefined;
    return { messages };
  });

  // ── before_agent_start: inject system prompt for agentic-auto mode ───────────
  pi.on("before_agent_start", async (event, _ctx) => {
    if (!currentConfig.value.enabled || currentConfig.value.pruneOn !== "agentic-auto") return undefined;
    // Append agentic-auto instructions to the system prompt
    const appended = AGENTIC_AUTO_SYSTEM_PROMPT;
    const original = event.systemPrompt ?? "";
    const newPrompt = original + "\n\n" + appended;
    return { systemPrompt: newPrompt };
  });

  // ── Register context_tree_query tool ──────────────────────────────────────
  registerQueryTool(pi, indexer);

  // ── Register context_prune tool (always registered, activated only in agentic-auto mode) ──
  registerContextPruneTool(pi, (ctx, options) => flushPending(ctx, { delivery: "runtime", ...options }));

  // ── Register /pruner command + summary message renderer ────────────
  registerCommands(pi, currentConfig, flushPending, capturePendingBatches, syncToolActivation, () => statsAccum.getStats(), indexer);
}
