---
name: 047-move-bundle-changes-to-source
description: Move pending-status behavior from the tracked generated bundle into TypeScript source, then stop tracking dist.
steps:
  - phase: discovery
    steps:
      - "- [x] step 1: map each bundle-only pending-status change to its source module"
  - phase: migration
    steps:
      - "- [x] step 1: implement active-branch capture, savings statistics, and pending-status behavior in source"
      - "- [x] step 2: implement small-batch skipping in the source flush path"
  - phase: validation
    steps:
      - "- [x] step 1: rebuild dist, remove it from Git tracking, and rewrite unpushed history"
      - "- [x] step 2: run targeted syntax and whitespace checks"
---

# 047-move-bundle-changes-to-source

## Phase 1 — Discovery
- [x] step 1: map each bundle-only pending-status change to its source module

## Phase 2 — Migration
- [x] step 1: implement active-branch capture, savings statistics, and pending-status behavior in source
- [x] step 2: implement small-batch skipping in the source flush path

## Phase 3 — Validation
- [x] step 1: rebuild dist, remove it from Git tracking, and rewrite unpushed history
- [x] step 2: run targeted syntax and whitespace checks
