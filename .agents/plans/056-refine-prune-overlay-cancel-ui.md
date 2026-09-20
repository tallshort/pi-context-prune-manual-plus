---
name: 056-refine-prune-overlay-cancel-ui
description: Keep only Pi's cancel key for manual prune and show progress status in the overlay title.
steps:
  - phase: regression
    steps:
      - "- [x] step 1: update the cancellation-key unit test to reject q"
  - phase: implementation
    steps:
      - "- [x] step 1: remove q from UI text and cancellation handling"
      - "- [x] step 2: render running and cancelling status in the title parentheses"
  - phase: validation
    steps:
      - "- [x] step 1: run unit tests and rebuild the ignored bundle"
---

# 056-refine-prune-overlay-cancel-ui

## Phase 1 — Regression
- [x] step 1: update the cancellation-key unit test to reject q

## Phase 2 — Implementation
- [x] step 1: remove q from UI text and cancellation handling
- [x] step 2: render running and cancelling status in the title parentheses

## Phase 3 — Validation
- [x] step 1: run unit tests and rebuild the ignored bundle
