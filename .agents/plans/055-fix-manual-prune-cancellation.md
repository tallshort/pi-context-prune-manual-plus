---
name: 055-fix-manual-prune-cancellation
description: Ensure Esc/q stops scheduling batch nine and later, backed by new unit tests.
steps:
  - phase: regression
    steps:
      - "- [x] step 1: add red unit tests for Pi cancellation input and bounded-worker abort behavior"
  - phase: repair
    steps:
      - "- [x] step 1: use Pi keybindings for cancellation and extract the bounded scheduler"
      - "- [x] step 2: route manual pruning through the tested scheduler"
  - phase: validation
    steps:
      - "- [x] step 1: run unit tests, build, and verify no ninth batch is scheduled after abort"
---

# 055-fix-manual-prune-cancellation

## Phase 1 — Regression
- [x] step 1: add red unit tests for Pi cancellation input and bounded-worker abort behavior

## Phase 2 — Repair
- [x] step 1: use Pi keybindings for cancellation and extract the bounded scheduler
- [x] step 2: route manual pruning through the tested scheduler

## Phase 3 — Validation
- [x] step 1: run unit tests, build, and verify no ninth batch is scheduled after abort
