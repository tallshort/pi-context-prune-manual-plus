---
name: 060-integrate-summarizer-usage-reporting
description: Integrate upstream summarizer usage reporting with Pi and pi-stats while preserving this fork's Pi 0.87 capture, retry, cancellation, and extended pruner statistics semantics.
steps:
  - phase: discovery
    steps:
      - "- [x] step 1: map upstream usage-reporting behavior onto the fork's flush, retry, and persistence paths"
      - "- [x] step 2: define acceptance checks for exactly-once pruner stats accounting and independent Pi/sidecar reporting"
  - phase: tests
    steps:
      - "- [x] step 1: add Vitest coverage for usage reporting, sidecar normalization, fallback, and rotation"
      - "- [x] step 2: add regression coverage proving successful calls are added to pruner stats exactly once"
      - "- [x] step 3: add failure, oversized, retry, and parallel-path coverage where provider usage must still be reported"
  - phase: implementation
    steps:
      - "- [x] step 1: add Pi usage-entry and pi-stats sidecar reporting modules"
      - "- [x] step 2: report each final provider response from the summarizer without changing summary outcomes"
      - "- [x] step 3: wire reporting into every provider attempt while preserving scheduler, retry, cancellation, frontier, and persistence behavior"
      - "- [x] step 4: move token/cost accumulation to the usage callback and remove settlement-time double counting"
      - "- [x] step 5: use Pi's agent directory for extension settings and usage sidecars"
  - phase: documentation
    steps:
      - "- [x] step 1: document Pi usage entries, sidecar behavior, and the relationship to pruner stats"
      - "- [x] step 2: keep SPEC lifecycle and source navigation documentation aligned"
  - phase: validation
    steps:
      - "- [x] step 1: run targeted usage and flush regression tests"
      - "- [x] step 2: run the complete test suite, build, and repository checks"
      - "- [x] step 3: inspect the final diff for duplicate accounting and unrelated changes"
---

# 060-integrate-summarizer-usage-reporting

Outcome: every paid summarizer response with usage is recorded once in Pi and the pi-stats sidecar, while the fork's `context-prune-stats` snapshot remains the source for `/pruner stats` and counts each provider response exactly once.

## Acceptance ledger

- A successful summarizer response increments `StatsAccumulator.callCount`, tokens, and cost exactly once—not once in `onUsage` and again during settlement.
- Responses carrying usage are reported even when their summary is oversized, has `stopReason: error`, or is discarded after a later persistence failure.
- Each real retry attempt with a final response is reported independently; a cooldown rejection that never calls the provider is not reported.
- Parallel batches wait for all started calls so completed usage callbacks cannot race with stats persistence.
- Pi receives a `type: "usage"` entry through `SessionManager.appendUsage` when available.
- The sidecar uses pi-stats v1 shape, contains no prompt/summary content, rotates at 16 MiB, and shares the Pi usage-entry identity when available.
- Usage-reporting failures warn at most once per session and never alter pruning, retry, cancellation, frontier, or recovery behavior.
- Existing extended pruner metrics—accepted raw/summary chars, retries, terminal failures, and failure categories—remain intact.
- Pi 0.87 effective-projection capture behavior remains unchanged.

## Phase 1 — Discovery

- [x] step 1: map upstream usage-reporting behavior onto the fork's flush, retry, and persistence paths
- [x] step 2: define acceptance checks for exactly-once pruner stats accounting and independent Pi/sidecar reporting

## Phase 2 — Tests

- [x] step 1: add Vitest coverage for usage reporting, sidecar normalization, fallback, and rotation
- [x] step 2: add regression coverage proving successful calls are added to pruner stats exactly once
- [x] step 3: add failure, oversized, retry, and parallel-path coverage where provider usage must still be reported

## Phase 3 — Implementation

- [x] step 1: add Pi usage-entry and pi-stats sidecar reporting modules
- [x] step 2: report each final provider response from the summarizer without changing summary outcomes
- [x] step 3: wire reporting into every provider attempt while preserving scheduler, retry, cancellation, frontier, and persistence behavior
- [x] step 4: move token/cost accumulation to the usage callback and remove settlement-time double counting
- [x] step 5: use Pi's agent directory for extension settings and usage sidecars

## Phase 4 — Documentation

- [x] step 1: document Pi usage entries, sidecar behavior, and the relationship to pruner stats
- [x] step 2: keep SPEC lifecycle and source navigation documentation aligned

## Phase 5 — Validation

- [x] step 1: run targeted usage and flush regression tests
- [x] step 2: run the complete test suite, build, and repository checks
- [x] step 3: inspect the final diff for duplicate accounting and unrelated changes
