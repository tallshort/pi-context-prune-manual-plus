# Changelog

All notable changes to this project are documented in this file.

## [1.7.0]

### Added

- Ported and extended upstream's [summarizer usage reporting](https://github.com/championswimmer/pi-context-prune/commit/b06e82f5cfbdeeaca81de3da99550312cabf20db) so every completed provider response with usage reaches Pi's standard session totals and a content-free pi-stats v1 sidecar, including failed, aborted, retried, and oversized summaries.
- Link Pi usage entries and sidecar records with shared identifiers when available, while preserving the existing `/pruner stats` view with exactly-once accounting.

### Fixed

- Isolate usage reporting, session identity lookup, diagnostics, and sidecar failures from prune settlement.
- Wait for every started parallel summarizer call so its usage is recorded before cumulative stats are persisted.
- Deduplicate usage warnings per identified session across transient session-ID failures and session-manager reuse.

### Changed

- Resolve extension settings and usage logs from Pi's agent directory, honoring `PI_CODING_AGENT_DIR`.
- Updated build and test dependencies.

## [1.6.2]

### Fixed

- Ported and extended upstream's [on-demand session hydration fix](https://github.com/championswimmer/pi-context-prune/commit/0758cb12511eeea18a51930840bae921e8475728) to initialize persisted pruning configuration before early `before_agent_start` and `context` hooks, so the first agentic-auto request receives its pruning tool, prompt, and persisted index filtering.
- Fail open when malformed persisted pruning metadata cannot be hydrated, preserving provider context instead of rejecting the request.

### Documented

- Document early lifecycle fallback hydration in the runtime event flow.

## [1.6.1]

### Fixed

- Leave image-bearing and other non-text tool results in provider context rather than indexing lossy text-only records.
- Count only visible matching tool results in the agentic-auto pruning reminder.

### Documented

- Clarified the Pi 0.87 context-edit boundary, `/pruner tree` raw-history semantics, and core lifecycle issues reserved for upstream design.

## [1.6.0]

### Fixed

- Added Pi 0.87+ compatibility for `context_edit`. Batch capture now uses Pi's effective provider-context projection, so omitted tool results are not indexed or summarized and replacement content is used instead of the original output.
