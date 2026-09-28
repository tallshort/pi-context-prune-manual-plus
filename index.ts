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
import { captureBatch, captureUnindexedBatchesFromProjection, groupBatchesByMode } from "./src/batch-capture.js";
import { executeFlushBatches } from "./src/flush-batch-executor.js";
import { settleFlushBatches, type FlushResult, type SessionAppender } from "./src/flush-settler.js";
import { DeferredSummaryCache } from "./src/deferred-summary-cache.js";
import { ToolCallIndexer } from "./src/indexer.js";
import { pruneMessages } from "./src/pruner.js";
import { annotateWithUnprunedCount, countUnprunedToolCalls } from "./src/reminder.js";
import { registerQueryTool } from "./src/query-tool.js";
import { registerCommands, pruneStatusText, setPruneStatusWidget } from "./src/commands.js";
import type { ContextPruneConfig, CapturedBatch, FlushOptions, SummarizeResult } from "./src/types.js";
import {
  DEFAULT_CONFIG,
  CONTEXT_PRUNE_TOOL_NAME,
  CONTEXT_TAG_TOOL_NAMES,
  AGENTIC_AUTO_SYSTEM_PROMPT,
  CUSTOM_TYPE_STATS,
} from "./src/types.js";
import { StatsAccumulator } from "./src/stats.js";
import { registerContextPruneTool } from "./src/context-prune-tool.js";
import { PruneFrontierTracker } from "./src/frontier.js";
import { hydrateSessionState } from "./src/session-hydration.js";
import { createSummarizerUsageReporter, type UsageSession } from "./src/usage-report.js";

export default function (pi: ExtensionAPI) {
  // Shared mutable config reference — updated by /pruner commands
  const currentConfig: { value: ContextPruneConfig } = {
    value: { ...DEFAULT_CONFIG, pruneOn: "every-turn" },
  };

  // Serialize config reads so an early lifecycle fallback cannot overwrite a
  // newer session-start refresh after both requests complete.
  let configLoadPromise: Promise<void> | undefined;
  const queueConfigReload = () => {
    const previous = configLoadPromise?.catch(() => undefined) ?? Promise.resolve();
    const next = previous.then(async () => {
      currentConfig.value = await loadConfig();
    });
    configLoadPromise = next;
    return next;
  };
  const ensureConfigLoaded = async () => {
    await (configLoadPromise ?? queueConfigReload());
  };

  // Shared indexer — rebuilt from session on every session_start / session_tree
  const indexer = new ToolCallIndexer();

  // Shared stats accumulator — tracks cumulative token/cost stats for summarizer calls
  const statsAccum = new StatsAccumulator();

  // Shared prune frontier — tracks the last completed prune attempt boundary
  const frontier = new PruneFrontierTracker();
  // Rebuilt on lifecycle events and defensively before the first context hook.
  let hydrated = false;
  const hydrateFromSession = (ctx: any): boolean => {
    try {
      hydrateSessionState(ctx, indexer, statsAccum, frontier);
      hydrated = true;
      return true;
    } catch {
      // Persisted custom entries are untrusted history. Keep provider context
      // intact rather than allowing a malformed record to reject this hook.
      indexer.reset();
      statsAccum.reset();
      frontier.reset();
      hydrated = false;
      return false;
    }
  };

  // Pending batches — accumulated until the prune trigger fires
  const pendingBatches: CapturedBatch[] = [];
  let isFlushing = false;
  // Successful batches behind a failed earlier batch remain reusable for this
  // extension process only. They are never indexed or pruned until settlement
  // later reaches them contiguously.
  const deferredSummaries = new DeferredSummaryCache<SummarizeResult>();


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

  const warnedUsageSessionIds = new Set<string>();
  const lastKnownUsageSessionIds = new WeakMap<object, string>();
  const notifyUsageError = (ctx: any, session: UsageSession, error: unknown) => {
    let sessionId = lastKnownUsageSessionIds.get(session) ?? "";
    try {
      const currentSessionId = session.getSessionId();
      if (currentSessionId) {
        sessionId = currentSessionId;
        lastKnownUsageSessionIds.set(session, currentSessionId);
      }
    } catch {
      // Reuse the last identified session; without one, skip an ambiguous warning.
    }
    if (!sessionId || warnedUsageSessionIds.has(sessionId)) return;
    warnedUsageSessionIds.add(sessionId);
    try {
      safeNotify(ctx, `pruner: could not record summarizer usage: ${errorMessage(error)}`, "warning");
    } catch {
      // Usage diagnostics must never change the flush result.
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

  const captureDeliverySession = (
    ctx: any,
    delivery: "runtime" | "session",
  ): { ok: true; usageSession: UsageSession; sessionManager?: SessionAppender } | { ok: false; result: FlushResult } => {
    try {
      const usageSession = ctx.sessionManager as UsageSession;
      const sessionManager = delivery === "session" ? usageSession as unknown as SessionAppender : undefined;
      return { ok: true, usageSession, sessionManager };
    } catch (err) {
      return {
        ok: false,
        result: {
          ok: false,
          reason: isStaleContextError(err) ? "stale-context" : "failed",
          error: errorMessage(err),
        },
      };
    }
  };

  const handleFlushError = (err: unknown, ctx: any, options: FlushOptions): FlushResult => {
    if (options.signal?.aborted) {
      setPruneStatusWidget(ctx, currentConfig.value, statsAccum.getStats());
      return { ok: false, reason: "aborted" };
    }
    if (isStaleContextError(err)) {
      return { ok: false, reason: "stale-context", error: errorMessage(err) };
    }
    safeNotify(ctx, `pruner: summarization failed: ${errorMessage(err)}`, "error");
    return { ok: false, reason: "failed", error: errorMessage(err) };
  };

  // ── Helper: capture + trim + group pending batches (no LLM work) ──────────
  // Exposed to commands.ts via registerCommands so /pruner now can preview the
  // queue before opening the multi-row progress overlay.
  const capturePendingBatches = (ctx: any): CapturedBatch[] => {
    let batches: CapturedBatch[] = [];
    try {
      const branch = ctx.sessionManager.getBranch();
      const projection = ctx.sessionManager.buildSessionProjection();
      batches = captureUnindexedBatchesFromProjection(
        branch,
        projection.entries,
        indexer,
        [CONTEXT_PRUNE_TOOL_NAME],
      );
    } catch {
      // Do not fall back to turn_end's raw batches: they may predate a
      // context_edit. Failing closed prevents hidden content being summarized.
    }
    batches = batches
      .map((batch) => trimBatchToPendingRange(batch))
      .filter((batch): batch is CapturedBatch => batch !== null);
    return groupBatchesByMode(batches, currentConfig.value.batchingMode);
  };

  const refreshPendingStatus = (ctx: any) => {
    const config = currentConfig.value;
    const stats = statsAccum.getStats();
    const pendingCount = config.enabled && config.showPruneStatusLine ? capturePendingBatches(ctx).length : 0;
    const text = config.pruneOn === "on-demand" || pendingCount === 0
      ? pruneStatusText(config, stats, pendingCount)
      : `prune: ${pendingCount} pending`;
    setPruneStatusWidget(ctx, config, text);
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

    // Snapshot before provider work, then drain before the first await.
    const batches = options.previewedBatches ?? capturePendingBatches(ctx);
    if (batches.length === 0) return { ok: false, reason: "empty" };
    if (options.signal?.aborted) return { ok: false, reason: "aborted" };
    pendingBatches.length = 0;
    isFlushing = true;

    const delivery = options.delivery ?? "runtime";
    // Session delivery must retain this original manager across provider awaits.
    const capturedSession = captureDeliverySession(ctx, delivery);
    if (!capturedSession.ok) {
      restoreBatches(batches);
      isFlushing = false;
      return capturedSession.result;
    }
    const { usageSession, sessionManager } = capturedSession;

    let reportedUsageCount = 0;
    let persistedUsageCount = 0;
    const reportUsage = createSummarizerUsageReporter({
      session: usageSession,
      addUsage: (usage) => statsAccum.add(usage),
      notifyError: (error) => notifyUsageError(ctx, usageSession, error),
    });
    const onUsage = (batch: CapturedBatch, response: import("@earendil-works/pi-ai").AssistantMessage) => {
      reportedUsageCount += Number(reportUsage(batch, response));
    };
    const persistStats = () => {
      try {
        if (delivery === "session") sessionManager!.appendCustomEntry(CUSTOM_TYPE_STATS, statsAccum.getStats());
        else statsAccum.persist(pi);
        persistedUsageCount = reportedUsageCount;
      } catch (err) {
        notifyUsageError(ctx, usageSession, err);
      }
    };

    try {
      setPruneStatusWidget(ctx, currentConfig.value, "prune: summarizing…");
      const execution = await executeFlushBatches({
        getConfig: () => currentConfig.value,
        batches,
        ctx,
        flushOptions: options,
        deferredSummaries,
        stats: statsAccum,
        onUsage,
      });
      return settleFlushBatches({
        config: currentConfig.value,
        flushOptions: options,
        ...execution,
        delivery: { pi, mode: delivery, sessionManager },
        state: {
          indexer,
          frontier,
          stats: statsAccum,
          deferredSummaries,
        },
        lifecycle: {
          restoreBatches,
          persistStats,
          updateStatus: () => setPruneStatusWidget(ctx, currentConfig.value, statsAccum.getStats()),
          safeNotify: (message, type) => safeNotify(ctx, message, type),
          isStaleContextError,
          errorMessage,
        },
      });
    } catch (err) {
      restoreBatches(batches);
      return handleFlushError(err, ctx, options);
    } finally {
      // Usage is durable even when execution or settlement exits exceptionally.
      if (reportedUsageCount > persistedUsageCount) persistStats();
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
    await queueConfigReload();

    // Rebuild all persisted pruning state from the active session branch.
    hydrateFromSession(ctx);

    // Clear any batches queued before the session reload
    pendingBatches.length = 0;
    deferredSummaries.clear();

    // Hydration is complete: include pending batches already present on reload.
    refreshPendingStatus(ctx);

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
    hydrateFromSession(ctx);
    // Pending batches belong to the old branch — discard them
    pendingBatches.length = 0;
    deferredSummaries.clear();
    refreshPendingStatus(ctx);
  });

  // Compaction changes the provider-visible tail without a turn_end.
  pi.on("session_compact", async (_event, ctx) => {
    // Old queued batches may no longer be visible after compaction.
    pendingBatches.length = 0;
    refreshPendingStatus(ctx);
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

    // Pi's event.turnIndex restarts for each agent run, while the frontier is
    // session-relative. Find the persisted assistant turn before comparing them.
    const resultIds = new Set(event.toolResults.map((result) => result.toolCallId));
    let sessionTurnIndex = 0;
    let matchedTurnIndex: number | null = null;
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type !== "message" || entry.message?.role !== "assistant") continue;
      if (entry.message.content?.some((block: any) => block.type === "toolCall" && resultIds.has(block.id))) {
        matchedTurnIndex = sessionTurnIndex;
        break;
      }
      sessionTurnIndex++;
    }
    const capturedBatch = matchedTurnIndex === null ? null : captureBatch(
      event.message, event.toolResults, matchedTurnIndex, Date.now(),
    );
    const batch = capturedBatch && trimBatchToPendingRange({
      ...capturedBatch,
      toolCalls: capturedBatch.toolCalls.filter((tc) => tc.toolName !== CONTEXT_PRUNE_TOOL_NAME),
    });
    if (!batch) {
      refreshPendingStatus(ctx);
      return;
    }

    pendingBatches.push(batch);

    if (currentConfig.value.pruneOn === "every-turn") {
      await flushPending(ctx, { delivery: "session" });
    } else {
      refreshPendingStatus(ctx);
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
    refreshPendingStatus(ctx);
  });

  // ── context: prune summarized tool results from next LLM call ─────────────
  pi.on("context", async (event, ctx) => {
    // session_start normally loads settings. If another extension starts an
    // agent turn first, load the persisted setting before deciding to return.
    await ensureConfigLoaded();
    syncToolActivation();
    if (!currentConfig.value.enabled) return undefined;

    // A context hook can run before this extension's session_start handler when
    // extensions are loaded in an unfavorable order. Rebuild state on demand so
    // persisted summaries are still removed from that first provider request.
    if (!hydrated) hydrateFromSession(ctx);

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
    // This can precede session_start when another extension starts the agent.
    await ensureConfigLoaded();
    syncToolActivation();
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
