---
name: 046-manual-prune-progress
description: Make /pruner now concurrent, observable, and safely cancellable.
steps:
  - phase: design
    steps:
      - "- [x] step 1: trace manual batch scheduling, progress rendering, and cancellation boundaries"
  - phase: implementation
    steps:
      - "- [x] step 1: process up to eight manual batches concurrently with per-batch progress"
      - "- [x] step 2: render a centered focusable overlay with up to sixteen rows and themed status output"
      - "- [x] step 3: softly cancel scheduling while preserving completed in-flight results"
      - "- [x] step 4: use Pi's configured cancel key and status-bearing overlay title"
      - "- [x] step 5: report completed-batch progress rather than a fixed worker count"
  - phase: validation
    steps:
      - "- [x] step 1: add regression tests for cancel-key recognition and post-abort scheduling"
      - "- [x] step 2: run unit tests and rebuild the ignored bundle"
      - "- [x] step 3: cover dynamic completed-batch title progress"
---

# 046-manual-prune-progress

## Phase 1 — Design
- [x] step 1: trace manual batch scheduling, progress rendering, and cancellation boundaries

## Phase 2 — Implementation
- [x] step 1: process up to eight manual batches concurrently with per-batch progress
- [x] step 2: render a centered focusable overlay with up to sixteen rows and themed status output
- [x] step 3: softly cancel scheduling while preserving completed in-flight results
- [x] step 4: use Pi's configured cancel key and status-bearing overlay title
- [x] step 5: report completed-batch progress rather than a fixed worker count

## Phase 3 — Validation
- [x] step 1: add regression tests for cancel-key recognition and post-abort scheduling
- [x] step 2: run unit tests and rebuild the ignored bundle
- [x] step 3: cover dynamic completed-batch title progress
