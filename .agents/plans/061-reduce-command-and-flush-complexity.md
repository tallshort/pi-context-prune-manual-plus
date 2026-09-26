---
name: 061-reduce-command-and-flush-complexity
description: Reduce cyclomatic complexity in command registration and flush orchestration without changing observable behavior.
steps:
  - phase: discovery
    steps:
      - "- [x] step 1: inspect command, flush, specification, and existing test seams"
      - "- [x] step 2: agree on registered-command and extension-lifecycle test seams"
  - phase: characterization
    steps:
      - "- [x] step 1: add command routing characterization tests"
      - "- [x] step 2: add flush lifecycle characterization tests"
  - phase: implementation
    steps:
      - "- [x] step 1: split command dispatch and settings/manual workflows into named handlers"
      - "- [x] step 2: extract batch execution from flushPending"
      - "- [x] step 3: extract settlement and persistence from flushPending"
  - phase: validation
    steps:
      - "- [x] step 1: run targeted tests and the full unit/integration suite"
      - "- [x] step 2: build the extension and run package checks"
      - "- [x] step 3: rescan production code and confirm the three reported functions are no longer High-CC leaders"
  - phase: review-follow-up
    steps:
      - "- [x] step 1: restore registerCommands callback type compatibility and update the code map"
      - "- [x] step 2: remove duplicated batch metrics and command enablement logic"
      - "- [x] step 3: group flush settlement dependencies and re-run verification"
---

# 061-reduce-command-and-flush-complexity

## Outcome

Reduce the complexity of `commands.registerCommands`, its registered command handler, and `index.flushPending` while preserving command behavior, lifecycle trigger boundaries, persistence ordering, cancellation, retries, usage accounting, and frontier invariants.

## Phase 1 — Discovery

- [x] step 1: inspect command, flush, specification, and existing test seams
- [x] step 2: agree on registered-command and extension-lifecycle test seams

## Phase 2 — Characterization

- [x] step 1: add command routing characterization tests
- [x] step 2: add flush lifecycle characterization tests

## Phase 3 — Implementation

- [x] step 1: split command dispatch and settings/manual workflows into named handlers
- [x] step 2: extract batch execution from `flushPending`
- [x] step 3: extract settlement and persistence from `flushPending`

## Phase 4 — Validation

- [x] step 1: run targeted tests and the full unit/integration suite
- [x] step 2: build the extension and run package checks
- [x] step 3: rescan production code and confirm the three reported functions are no longer High-CC leaders

## Phase 5 — Review follow-up

- [x] step 1: restore `registerCommands` callback type compatibility and update the code map
- [x] step 2: remove duplicated batch metrics and command enablement logic
- [x] step 3: group flush settlement dependencies and re-run verification

## Guardrails

- Keep the exported `registerCommands(...)` interface and all `/pruner` syntax unchanged.
- Keep automatic and manual scheduling semantics distinct; manual cancellation remains soft.
- Preserve runtime/session delivery ordering and index-before-prune recovery guarantees.
- Preserve result reasons, notifications, status updates, and once-per-provider-response usage accounting.
- Test only through the agreed registered-command and extension-lifecycle seams; extracted helpers remain internal implementation details.
