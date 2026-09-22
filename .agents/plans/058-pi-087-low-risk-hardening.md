---
name: 058-pi-087-low-risk-hardening
description: Document the Pi 0.87 compatibility boundary and safely handle projected non-text results and reminder counts without changing pruning persistence semantics.
steps:
  - phase: scope
    steps:
      - "- [x] step 1: record the upstream-owned context-edit gaps and the fork-owned low-risk scope"
  - phase: tests
    steps:
      - "- [x] step 1: add regression tests for non-text projected results and visible-result reminder counting"
      - "- [x] step 2: cover legacy indexed non-text results remaining visible"
      - "- [x] step 3: exercise legacy index reconstruction before context pruning"
  - phase: implementation
    steps:
      - "- [x] step 1: fail open for tool results containing non-text content"
      - "- [x] step 2: prevent legacy indexed non-text results from being pruned"
      - "- [x] step 3: count only visible, matching unpruned tool results in the reminder"
      - "- [x] step 4: document raw-history tree semantics and upstream issue candidates in README"
  - phase: validation
    steps:
      - "- [x] step 1: run focused tests, full tests, and package checks in an isolated Node workspace"
---

# 058-pi-087-low-risk-hardening

## Phase 1 — Scope
- [x] step 1: record the upstream-owned context-edit gaps and the fork-owned low-risk scope

## Phase 2 — Tests
- [x] step 1: add regression tests for non-text projected results and visible-result reminder counting
- [x] step 2: cover legacy indexed non-text results remaining visible
- [x] step 3: exercise legacy index reconstruction before context pruning

## Phase 3 — Implementation
- [x] step 1: fail open for tool results containing non-text content
- [x] step 2: prevent legacy indexed non-text results from being pruned
- [x] step 3: count only visible, matching unpruned tool results in the reminder
- [x] step 4: document raw-history tree semantics and upstream issue candidates in README

## Phase 4 — Validation
- [x] step 1: run focused tests, full tests, and package checks in an isolated Node workspace
