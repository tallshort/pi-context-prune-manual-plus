# Changelog

All notable changes to this project are documented in this file.

## [1.6.1]

### Fixed

- Leave image-bearing and other non-text tool results in provider context rather than indexing lossy text-only records.
- Count only visible matching tool results in the agentic-auto pruning reminder.

### Documented

- Clarified the Pi 0.87 context-edit boundary, `/pruner tree` raw-history semantics, and core lifecycle issues reserved for upstream design.

## [1.6.0]

### Fixed

- Added Pi 0.87+ compatibility for `context_edit`. Batch capture now uses Pi's effective provider-context projection, so omitted tool results are not indexed or summarized and replacement content is used instead of the original output.
