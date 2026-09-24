# TODO

Future improvements that preserve the core context-pruning algorithm.

## Reliability and controls

- [x] Make `/pruner now` concurrency configurable (manually verified by the user).
- [ ] Add shared provider rate-limit cooldown and automatic throttling for all summarizer triggers (awaiting manual verification).
- [x] Reuse successful out-of-order batch summaries in memory when an earlier batch fails, without advancing the contiguous frontier; clear them on reload or branch changes (manually verified by the user).
- [ ] Persist deferred batch summaries across reloads so they can later commit without another provider call (low priority).
- [x] Add one automatic retry for retryable `/pruner now` summarizer/provider failures, with per-batch failure visibility and cumulative retry/failure statistics (manually verified by the user).
- [ ] Offer an opt-in catch-up flush for eligible historical pending batches after `/pruner on`, without triggering provider calls automatically.
- [x] Add a dry-run/debug mode that reports candidate batches and estimated savings without writing summaries or advancing the frontier (manually verified by the user).
- [ ] **Pi core dependency:** calculate ephemeral context usage from messages after extension `context` hooks run, and use that value for both footer display and auto-compaction. Until Pi exposes this, prune can reduce the next provider request while Pi continues to display and compact against stale session usage.

## Summarization policy and compaction

- [ ] Batch multiple turn summaries into a meta-summary at compaction time.
- [ ] Add a token-count threshold for pruning once reliable per-tool-result token counts are available.
## Visibility and maintenance

- [ ] Report summarizer usage through Pi usage entries and the pi-stats sidecar while preserving exactly-once `/pruner stats` accounting.
- [ ] Improve savings reporting with compression ratio and raw/summary character totals alongside the current cost estimate.
- [ ] Add index maintenance commands: export, clear, and filter pruned records by turn or tool name.
- [x] Deliver a focusable `/pruner now` overlay with concurrent batch progress, soft cancellation, and automatic close after processing (manually verified by the user).
- [ ] Integrate with Pi's native settings UI when it exposes an extension settings API.

## Test coverage

- [x] Extend unit tests beyond manual cancellation: cover compaction-boundary capture, small-batch threshold handling, partial flush failures, and frontier advancement. (manually verified by the user)
- [x] Add integration-style tests for `/pruner now` progress and cancellation. (manually verified by the user)
- [ ] Add integration-style test for session-branch restoration.
- [ ] Hydrate the persisted index, stats, and frontier on demand from the context hook to handle extension lifecycle ordering.
- [x] Support Pi 0.87 context-edit projection during batch capture so omitted or replaced tool results never reach the pruner. (manually verified by the user)
- [ ] Harden low-risk Pi 0.87 integration: fail open for non-text tool results, count only visible results in reminders, and document upstream-owned context-edit gaps.
