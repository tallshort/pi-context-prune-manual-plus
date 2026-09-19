---
name: 048-audit-bundle-source-migration
description: Audit every original pending-status patch hunk against TypeScript source and repair any omissions.
steps:
  - phase: audit
    steps:
      - "- [x] step 1: map every original patch hunk to source behavior"
  - phase: repair
    steps:
      - "- [x] step 1: restore every missing source behavior"
  - phase: validation
    steps:
      - "- [x] step 1: rebuild the ignored bundle and verify all audited behaviors"
---

# 048-audit-bundle-source-migration

## Phase 1 — Audit
- [x] step 1: map every original patch hunk to source behavior

## Phase 2 — Repair
- [x] step 1: restore every missing source behavior

## Phase 3 — Validation
- [x] step 1: rebuild the ignored bundle and verify all audited behaviors
