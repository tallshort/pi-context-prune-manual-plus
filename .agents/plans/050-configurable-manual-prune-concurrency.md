---
name: 050-configurable-manual-prune-concurrency
description: Make `/pruner now` batch concurrency a validated, persisted user setting.
steps:
  - phase: design
    steps:
      - "- [x] step 1: trace config, settings, command, and bounded scheduler call paths"
      - "- [x] step 2: set a default of 8 and a safe inclusive range of 1–16 concurrent manual batches"
  - phase: implementation
    steps:
      - "- [x] step 1: add validated persisted configuration and tests"
      - "- [x] step 2: expose settings and `/pruner manual-concurrency [n]` command"
      - "- [x] step 3: use the configured value in `/pruner now` scheduling"
      - "- [x] step 4: update README and SPEC"
  - phase: validation
    steps:
      - "- [x] step 1: run tests, isolated build, and diff validation"
---

# 050-configurable-manual-prune-concurrency

## Phase 1 — Design
- [x] step 1: trace config, settings, command, and bounded scheduler call paths
- [x] step 2: set a default of 8 and a safe inclusive range of 1–16 concurrent manual batches

## Phase 2 — Implementation
- [x] step 1: add validated persisted configuration and tests
- [x] step 2: expose settings and `/pruner manual-concurrency [n]` command
- [x] step 3: use the configured value in `/pruner now` scheduling
- [x] step 4: update README and SPEC

## Phase 3 — Validation
- [x] step 1: run tests, isolated build, and diff validation
