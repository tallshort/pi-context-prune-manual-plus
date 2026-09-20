---
name: 049-dry-run-preview
description: Add a non-mutating `/pruner dry-run` command that previews pending pruning work and derives a historical savings estimate.
steps:
  - phase: design
    steps:
      - "- [x] step 1: define candidate, threshold-skip, and historical-estimate semantics without invoking flush"
  - phase: implementation
    steps:
      - "- [x] step 1: add a pure preview calculator with focused unit tests"
      - "- [x] step 2: register `/pruner dry-run` without summarizer, persistence, or frontier mutation"
      - "- [x] step 3: document the command and non-mutating lifecycle contract"
  - phase: validation
    steps:
      - "- [x] step 1: run tests, isolated build, and diff validation"
---

# 049-dry-run-preview

## Phase 1 — Design
- [x] step 1: define candidate, threshold-skip, and historical-estimate semantics without invoking flush

`/pruner dry-run` captures the same pending batches as `/pruner now`, but does not call the summarizer or flush pipeline. A candidate exceeds the configured raw-character threshold (or all batches when the threshold is zero). The historical estimate uses prior accepted summary/raw character totals; it is explicitly unavailable when no such history exists.

## Phase 2 — Implementation
- [x] step 1: add a pure preview calculator with focused unit tests
- [x] step 2: register `/pruner dry-run` without summarizer, persistence, or frontier mutation
- [x] step 3: document the command and non-mutating lifecycle contract

## Phase 3 — Validation
- [x] step 1: run tests, isolated build, and diff validation
