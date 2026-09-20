---
name: 051-manual-prune-safety-followups
description: Close the small manual-prune safety gaps found in dual-axis review: failure-message redaction and cancellation-time statistics persistence.
steps:
  - phase: design
    steps:
      - "- [x] step 1: isolate credential redaction and no-frontier statistics persistence as independent fixes"
  - phase: implementation
    steps:
      - "- [x] step 1: add regression tests for common bearer-token error formats"
      - "- [x] step 2: ensure completed-work statistics persist even when the frontier cannot advance"
      - "- [x] step 3: implement both focused fixes"
  - phase: validation
    steps:
      - "- [x] step 1: run tests, isolated build, and diff validation"
---

# 051-manual-prune-safety-followups

## Phase 1 — Design
- [x] step 1: isolate credential redaction and no-frontier statistics persistence as independent fixes

## Phase 2 — Implementation
- [x] step 1: add regression tests for common bearer-token error formats
- [x] step 2: ensure completed-work statistics persist even when the frontier cannot advance
- [x] step 3: implement both focused fixes

## Phase 3 — Validation
- [x] step 1: run tests, isolated build, and diff validation
