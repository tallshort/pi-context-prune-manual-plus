---
name: 051-centered-prune-progress-overlay
description: Replace the manual-prune hint with a focusable centered overlay showing up to sixteen live batch rows.
steps:
  - phase: design
    steps:
      - "- [x] step 1: adapt the focused-overlay lifecycle from pi-btw"
  - phase: implementation
    steps:
      - "- [x] step 1: render a centered focusable progress overlay with sixteen rows"
      - "- [x] step 2: route Esc/q to soft cancellation and close only after flushing completes"
  - phase: validation
    steps:
      - "- [x] step 1: rebuild and verify focus, row limit, and close lifecycle"
---

# 051-centered-prune-progress-overlay

## Phase 1 — Design
- [x] step 1: adapt the focused-overlay lifecycle from pi-btw

## Phase 2 — Implementation
- [x] step 1: render a centered focusable progress overlay with sixteen rows
- [x] step 2: route Esc/q to soft cancellation and close only after flushing completes

## Phase 3 — Validation
- [x] step 1: rebuild and verify focus, row limit, and close lifecycle
