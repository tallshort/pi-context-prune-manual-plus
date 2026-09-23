---
name: 059-on-demand-session-hydration
description: Port upstream's on-demand session hydration guard without changing this fork's manual pruning defaults.
steps:
  - phase: scope
    steps:
      - "- [x] step 1: compare upstream hydration behavior with this fork's session lifecycle and preserve existing defaults"
  - phase: tests
    steps:
      - "- [x] step 1: add an integration-style regression test for reconstructed index, stats, and frontier before pruning"
      - "- [x] step 2: exercise context-before-session_start with persisted enabled configuration"
      - "- [x] step 3: exercise before_agent_start before session_start in agentic-auto mode"
      - "- [x] step 4: verify each session_start refreshes persisted configuration"
      - "- [x] step 5: cover an early-load/session-start refresh race"
      - "- [x] step 6: preserve provider context when persisted hydration data is malformed"
  - phase: implementation
    steps:
      - "- [x] step 1: centralize hydration and invoke it from session lifecycle handlers and the context guard"
      - "- [x] step 2: initialize persisted configuration before the context fallback gate"
      - "- [x] step 3: initialize agentic-auto prompt and tool activation before session_start"
      - "- [x] step 4: preserve configuration refresh on every session_start"
      - "- [x] step 5: serialize early and session-start configuration reads"
      - "- [x] step 6: reset partial state and fail open when hydration throws"
  - phase: documentation
    steps:
      - "- [x] step 1: document the early lifecycle fallback in README"
  - phase: validation
    steps:
      - "- [x] step 1: run focused tests, full tests, and package checks in an isolated Node workspace"
---

# 059-on-demand-session-hydration

## Phase 1 — Scope
- [x] step 1: compare upstream hydration behavior with this fork's session lifecycle and preserve existing defaults

## Phase 2 — Tests
- [x] step 1: add an integration-style regression test for reconstructed index, stats, and frontier before pruning
- [x] step 2: exercise context-before-session_start with persisted enabled configuration
- [x] step 3: exercise before_agent_start before session_start in agentic-auto mode
- [x] step 4: verify each session_start refreshes persisted configuration
- [x] step 5: cover an early-load/session-start refresh race
- [x] step 6: preserve provider context when persisted hydration data is malformed

## Phase 3 — Implementation
- [x] step 1: centralize hydration and invoke it from session lifecycle handlers and the context guard
- [x] step 2: initialize persisted configuration before the context fallback gate
- [x] step 3: initialize agentic-auto prompt and tool activation before session_start
- [x] step 4: preserve configuration refresh on every session_start
- [x] step 5: serialize early and session-start configuration reads
- [x] step 6: reset partial state and fail open when hydration throws

## Phase 4 — Documentation
- [x] step 1: document the early lifecycle fallback in README

## Phase 5 — Validation
- [x] step 1: run focused tests, full tests, and package checks in an isolated Node workspace
