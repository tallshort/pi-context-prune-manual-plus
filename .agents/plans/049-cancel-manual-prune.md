---
name: 049-cancel-manual-prune
description: Let /pruner now stop launching new batches while retaining completed prune results.
steps:
  - phase: design
    steps:
      - "- [x] step 1: trace overlay dismissal, abort signals, worker dispatch, and pending-batch restoration"
  - phase: implementation
    steps:
      - "- [x] step 1: stop new manual workers when cancellation is requested"
      - "- [x] step 2: persist completed results and restore only unfinished batches"
      - "- [x] step 3: expose cancellation state in the progress UI"
  - phase: validation
    steps:
      - "- [x] step 1: document cancellation semantics and run targeted checks"
---

# 049-cancel-manual-prune

## Phase 1 — Design
- [x] step 1: trace overlay dismissal, abort signals, worker dispatch, and pending-batch restoration

## Phase 2 — Implementation
- [x] step 1: stop new manual workers when cancellation is requested
- [x] step 2: persist completed results and restore only unfinished batches
- [x] step 3: expose cancellation state in the progress UI

## Phase 3 — Validation
- [x] step 1: document cancellation semantics and run targeted checks
