---
name: 048-core-pipeline-unit-tests
description: Add focused unit coverage for capture boundaries, threshold filtering, failed flush recovery, and frontier safety.
steps:
  - phase: design
    steps:
      - "- [x] step 1: define independent test seams for capture, threshold, and flush/frontier behavior"
  - phase: implementation
    steps:
      - "- [x] step 1: add active-branch capture tests"
      - "- [x] step 2: add raw-character threshold tests"
      - "- [x] step 3: add failed-flush recovery and frontier-safety tests"
  - phase: validation
    steps:
      - "- [x] step 1: run the full unit suite; TODO remains open pending manual verification"
---

# 048-core-pipeline-unit-tests

## Phase 1 — Design
- [x] step 1: define independent test seams for capture, threshold, and flush/frontier behavior

## Phase 2 — Implementation
- [x] step 1: add active-branch capture tests
- [x] step 2: add raw-character threshold tests
- [x] step 3: add failed-flush recovery and frontier-safety tests

## Phase 3 — Validation
- [x] step 1: run the full unit suite; TODO remains open pending manual verification
