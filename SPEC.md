# Context Prune Specification

This document defines stable internal behavior and invariants for the context-pruning system. It does not define user commands, defaults, or TUI presentation; those belong in [README.md](README.md).

[PRUNING.md](PRUNING.md) is retained from the upstream project as an algorithm and research-background reference. When it differs from this document, this specification is authoritative for the fork's current runtime behavior.

## 1. Purpose and boundary

Context pruning reduces the messages sent in future model context while retaining enough information to recover any removed tool result.

- Session history remains the durable record of the conversation.
- The `context` event is the only place where already-pruned `toolResult` messages are removed from the model-visible message list.
- Assistant tool-call blocks remain in context so tool-call IDs and recovery references stay available.
- A tool result is pruned only after its full original content is recorded in the index.

## 2. Recovery invariant

For every pruned tool result, `context_tree_query` must be able to retrieve its original result text by full tool-call ID or an assigned short reference.

The index is therefore the authority for whether a tool result may be removed from future context:

1. persist or register the original tool-call record;
2. record the corresponding summary reference;
3. only then let `pruneMessages()` omit that result.

If persistence fails, the affected batch remains eligible for a future flush.

## 3. Capture invariant

A captured batch contains completed tool calls from one assistant turn, plus the turn's non-tool assistant text.

When scanning a session branch:

- only the active tail retained after the latest compaction is eligible;
- a tool call is eligible only when its matching result exists and is not already indexed;
- pruner housekeeping calls are excluded from capture;
- turn indexes remain stable across prune cycles; and
- batching may merge related captured batches, but must not change the tool-call identity of a batch member.

## 4. Flush lifecycle

A flush snapshots the eligible batches before awaiting model work and prevents concurrent flushes.

`/pruner dry-run` may use the same capture and raw-character threshold rules to report pending candidates, but it is not a flush: it must not call a provider or write summaries, index records, statistics, or frontier state. Its savings estimate is derived only from already accepted historical summary compression and is unavailable without that history.
For each batch:

1. apply the configured raw-character threshold, if enabled;
2. summarize the batch;
3. compare rendered summary size with raw result size;
4. if the summary is smaller, persist the hidden summary and original-tool index records;
5. if it is not smaller, keep original results but advance the frontier past the attempted range.

A failed summary or persistence operation restores unfinished work for retry. A successfully indexed batch must not be re-summarized.

For `/pruner now` only, a structured summarizer/provider failure classified as rate-limit, network, or temporary provider error is retried once before the batch is restored. Cancellation, stale-context, persistence failures, threshold skips, and oversized-summary skips are never retried. Runtime overlay rows may retain a normalized failure kind and truncated, sanitized first-line message, but raw provider errors and stacks must not be written to session or index records.

A process-local shared provider cooldown applies before every summarizer request, independent of its flush trigger. A rate-limit failure enters bounded exponential backoff (5 seconds, doubling to 60 seconds); requests during cooldown do not call the provider and remain pending for a later flush. The cooldown is intentionally not durable across session reloads.

## 5. Frontier invariant

The prune frontier records the latest contiguous attempted range. It prevents repeated attempts over already-handled ranges while allowing capture to continue after that range.

For a partial manual cancellation, completed workers may finish out of order. The frontier advances only through the contiguous completed prefix; later completed batches remain protected by the index and are not retried.

## 6. Delivery and persistence

Flush delivery has two modes:

- **runtime** delivery uses Pi's runtime-safe message path during active agent/tool execution;
- **session** delivery writes directly to the session when runtime APIs may no longer be available.

Every final summarizer provider response carrying usage is accounted once at response completion, independently of summary acceptance or later persistence. A distinct retry response is a distinct paid call. The accounting boundary updates the pruner's cumulative stats, appends Pi's standard usage entry when supported, and writes the content-free pi-stats sidecar; failures in usage reporting must not change flush settlement.

Index records, summaries, frontier snapshots, and statistics are persisted as session custom entries. Session start and branch changes reconstruct the in-memory index and statistics from the active branch.

## 7. Manual-prune cancellation

Manual pruning uses configured bounded scheduling (default 8, validated range 1–16) with soft cancellation:

- cancellation prevents dispatch of additional batches;
- already-started summary calls finish;
- completed results are persisted normally; and
- undispatched or failed work remains pending; and
- a cancellation suppresses any not-yet-started retry attempt.

The cancellation key is resolved through Pi's configured selection-cancel binding. The scheduler behavior is covered by unit tests.

## 8. Maintenance boundaries

- [README.md](README.md) owns user-facing commands, settings, defaults, and TUI behavior.
- [AGENTS.md](AGENTS.md) owns agent workflow and stable source navigation.
- This file owns cross-module invariants and lifecycle contracts.
- Feature plans in `.agents/plans/` record implementation progress; [TODO.md](TODO.md) records unstarted work.
