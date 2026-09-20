# TODO

Future improvements that preserve the core context-pruning algorithm.

## Reliability and controls

- [ ] Make `/pruner now` concurrency configurable, with provider-limit backoff and automatic throttling after retryable failures.
- [ ] Add per-batch retry state, retry counts, and a command to retry only failed pending batches.
- [ ] Add a dry-run/debug mode that reports candidate batches and estimated savings without writing summaries or advancing the frontier.
- [ ] **Pi core dependency:** calculate ephemeral context usage from messages after extension `context` hooks run, and use that value for both footer display and auto-compaction. Until Pi exposes this, prune can reduce the next provider request while Pi continues to display and compact against stale session usage.

## Visibility and maintenance

- [ ] Show queue totals (batch count, tool-call count, and raw characters) in the manual-prune overlay and status output.
- [ ] Improve savings reporting with compression ratio and raw/summary character totals alongside the current cost estimate.
- [ ] Add index maintenance commands: export, clear, and filter pruned records by turn or tool name.
- [x] Deliver a focusable `/pruner now` overlay with concurrent batch progress, soft cancellation, and automatic close after processing (manually verified by the user).

## Test coverage

- [x] Extend unit tests beyond manual cancellation: cover compaction-boundary capture, small-batch threshold handling, partial flush failures, and frontier advancement. (manually verified by the user)
- [ ] Add integration-style tests for `/pruner now` progress, cancellation, and session-branch restoration.
