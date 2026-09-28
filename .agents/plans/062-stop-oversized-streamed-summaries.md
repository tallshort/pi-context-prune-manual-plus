---
name: 062-stop-oversized-streamed-summaries
description: Skip a batch once its streamed summary exceeds its raw result, without losing accounting or other batches.
steps:
  - phase: discovery
    steps:
      - "- [x] step 1: trace stream, batch execution, settlement, and cancellation contracts"
  - phase: tests
    steps:
      - "- [x] step 1: test early oversized skip, normal result, usage, and concurrent settlement"
  - phase: implementation
    steps:
      - "- [x] step 1: add per-batch early-skip result and wire it through both execution paths"
      - "- [x] step 2: settle skipped batches without indexing raw results"
      - "- [x] step 3: document behavior"
  - phase: review follow-ups
    steps:
      - "- [x] step 1: persist skips behind frontier gaps, and exclude them after reload or branch hydration"
      - "- [x] step 2: account for streamed partial usage when the aborted provider's result rejects"
      - "- [x] step 3: cover both interruption and out-of-order skip paths in integration tests"
      - "- [x] step 4: preflight final rendered size and persist every skip before ordered commits, including persistence-failure gaps"
      - "- [x] step 5: skip exactly equal rendered summaries and align usage documentation after review"
  - phase: validation
    steps:
      - "- [x] step 1: run full tests and package check in sandbox-local copy"
      - "- [x] step 2: verify marker-write isolation and resolved-without-usage fallback after review"
      - "- [x] step 3: validate the latest low-risk review fixes"
---

# 062-stop-oversized-streamed-summaries

## Phase 1 — Discovery
- [x] step 1: trace stream, batch execution, settlement, and cancellation contracts

## Phase 2 — Tests
- [x] step 1: test early oversized skip, normal result, usage, and concurrent settlement

## Phase 3 — Implementation
- [x] step 1: add per-batch early-skip result and wire it through both execution paths
- [x] step 2: settle skipped batches without indexing raw results
- [x] step 3: document behavior

## Phase 4 — Review follow-ups
- [x] step 1: persist skips behind frontier gaps, and exclude them after reload or branch hydration
- [x] step 2: account for streamed partial usage when the aborted provider's result rejects
- [x] step 3: cover both interruption and out-of-order skip paths in integration tests
- [x] step 4: preflight final rendered size and persist every skip before ordered commits, including persistence-failure gaps
- [x] step 5: skip exactly equal rendered summaries and align usage documentation after review

## Phase 5 — Validation
- [x] step 1: run full tests and package check in sandbox-local copy
- [x] step 2: verify marker-write isolation and resolved-without-usage fallback after review
- [x] step 3: validate the latest low-risk review fixes
