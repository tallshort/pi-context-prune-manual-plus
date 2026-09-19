---
name: 045-apply-pending-status-patch
description: Create a branch and apply the supplied pending-status patch to the generated extension bundle.
steps:
  - phase: setup
    steps:
      - "- [x] step 1: create a dedicated branch and inspect the patch target"
  - phase: application
    steps:
      - "- [x] step 1: restore the published bundle required by the patch"
      - "- [x] step 2: apply the supplied patch"
  - phase: verification
    steps:
      - "- [x] step 1: inspect the staged bundle and verify it parses"
---

# 045-apply-pending-status-patch

## Phase 1 — Setup
- [x] step 1: create a dedicated branch and inspect the patch target

## Phase 2 — Application
- [x] step 1: restore the published bundle required by the patch
- [x] step 2: apply the supplied patch

## Phase 3 — Verification
- [x] step 1: inspect the staged bundle and verify it parses
