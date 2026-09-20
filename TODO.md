# TODO

Future improvements that preserve the core context-pruning algorithm.

## Reliability and controls

- [x] Make `/pruner now` concurrency configurable (manually verified by the user).
- [ ] Add provider-limit backoff and automatic throttling after retryable failures.
- [x] Reuse successful out-of-order batch summaries in memory when an earlier batch fails, without advancing the contiguous frontier; clear them on reload or branch changes (manually verified by the user).
- [ ] Persist deferred batch summaries across reloads so they can later commit without another provider call (low priority).
- [x] Add one automatic retry for retryable `/pruner now` summarizer/provider failures, with per-batch failure visibility and cumulative retry/failure statistics (manually verified by the user).
- [x] Add a dry-run/debug mode that reports candidate batches and estimated savings without writing summaries or advancing the frontier (manually verified by the user).
- [ ] **Pi core dependency:** calculate ephemeral context usage from messages after extension `context` hooks run, and use that value for both footer display and auto-compaction. Until Pi exposes this, prune can reduce the next provider request while Pi continues to display and compact against stale session usage.

## Visibility and maintenance

- [ ] Improve savings reporting with compression ratio and raw/summary character totals alongside the current cost estimate.
- [ ] Add index maintenance commands: export, clear, and filter pruned records by turn or tool name.
- [x] Deliver a focusable `/pruner now` overlay with concurrent batch progress, soft cancellation, and automatic close after processing (manually verified by the user).

## Test coverage

- [x] Extend unit tests beyond manual cancellation: cover compaction-boundary capture, small-batch threshold handling, partial flush failures, and frontier advancement. (manually verified by the user)
- [x] Add integration-style tests for `/pruner now` progress and cancellation. (manually verified by the user)
- [ ] Add an integration-style test for session-branch restoration.
