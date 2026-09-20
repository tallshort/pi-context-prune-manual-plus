---
name: 052-compaction-stable-turn-index
description: Preserve session-relative assistant turn ordinals when scanning the active post-compaction branch.
steps:
  - phase: design
    steps:
      - "- [x] step 1: confirm compaction keeps prior session entries available for ordinal offset calculation"
  - phase: implementation
    steps:
      - "- [x] step 1: add a regression test for post-compaction turn indexes"
      - "- [x] step 2: offset active-tail counting by preceding assistant messages"
  - phase: validation
    steps:
      - "- [x] step 1: run tests, isolated build, and diff validation"
---

# 052-compaction-stable-turn-index

## Phase 1 — Design
- [x] step 1: confirm compaction keeps prior session entries available for ordinal offset calculation

## Phase 2 — Implementation
- [x] step 1: add a regression test for post-compaction turn indexes
- [x] step 2: offset active-tail counting by preceding assistant messages

## Phase 3 — Validation
- [x] step 1: run tests, isolated build, and diff validation
