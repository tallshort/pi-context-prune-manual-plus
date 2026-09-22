---
name: 057-pi-087-context-edit-projection
description: Make batch capture consume Pi 0.87's effective context projection so context edits cannot reintroduce hidden raw tool results.
steps:
  - phase: discovery
    steps:
      - "- [x] step 1: inspect Pi 0.87 typings and current capture tests to establish the projection contract"
      - "- [x] step 2: trace capture and flush call sites plus indexing behavior"
  - phase: tests
    steps:
      - "- [x] step 1: add regression coverage for omitted, replaced, compaction-boundary, and unrelated context edits"
  - phase: implementation
    steps:
      - "- [x] step 1: project context through Pi's canonical API before session capture while retaining provenance"
      - "- [x] step 2: update Pi development dependencies to 0.87"
  - phase: validation
    steps:
      - "- [x] step 1: run focused tests, full tests, build, and package checks"
---

# 057-pi-087-context-edit-projection

## Phase 1 — Discovery
- [x] step 1: inspect Pi 0.87 typings and current capture tests to establish the projection contract
- [x] step 2: trace capture and flush call sites plus indexing behavior

## Phase 2 — Tests
- [x] step 1: add regression coverage for omitted, replaced, compaction-boundary, and unrelated context edits

## Phase 3 — Implementation
- [x] step 1: project context through Pi's canonical API before session capture while retaining provenance
- [x] step 2: update Pi development dependencies to 0.87

## Phase 4 — Validation
- [x] step 1: run focused tests, full tests, build, and package checks
