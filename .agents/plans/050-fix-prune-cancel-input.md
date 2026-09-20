---
name: 050-fix-prune-cancel-input
description: Make the manual-prune cancellation overlay receive Esc and q input.
steps:
  - phase: diagnosis
    steps:
      - "- [x] step 1: verify why the cancellation overlay does not receive input"
  - phase: repair
    steps:
      - "- [x] step 1: replace the passive Text overlay with an input-handling component"
      - "- [x] step 2: focus the overlay so it receives Esc and q"
  - phase: validation
    steps:
      - "- [x] step 1: rebuild and verify the focused cancellation overlay"
---

# 050-fix-prune-cancel-input

## Phase 1 — Diagnosis
- [x] step 1: verify why the cancellation overlay does not receive input

## Phase 2 — Repair
- [x] step 1: replace the passive Text overlay with an input-handling component
- [x] step 2: focus the overlay so it receives Esc and q

## Phase 3 — Validation
- [x] step 1: rebuild and verify the focused cancellation overlay
