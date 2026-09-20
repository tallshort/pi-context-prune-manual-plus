---
name: 047-configurable-raw-char-threshold
description: Add a persisted minRawCharsThreshold setting for batch-summary skipping.
steps:
  - phase: design
    steps:
      - "- [x] step 1: trace config, settings overlay, command, and skip decision paths"
  - phase: implementation
    steps:
      - "- [x] step 1: persist a validated threshold with a default of zero"
      - "- [x] step 2: expose the threshold in settings and a direct command"
      - "- [x] step 3: apply the threshold to manual and automatic batch filtering"
  - phase: validation
    steps:
      - "- [x] step 1: update documentation and rebuild the ignored bundle"
---

# 047-configurable-raw-char-threshold

## Phase 1 — Design
- [x] step 1: trace config, settings overlay, command, and skip decision paths

## Phase 2 — Implementation
- [x] step 1: persist a validated threshold with a default of zero
- [x] step 2: expose the threshold in settings and a direct command
- [x] step 3: apply the threshold to manual and automatic batch filtering

## Phase 3 — Validation
- [x] step 1: update documentation and rebuild the ignored bundle
