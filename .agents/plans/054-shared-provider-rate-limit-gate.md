---
name: 054-shared-provider-rate-limit-gate
description: Protect every summarizer trigger with one process-local rate-limit cooldown and bounded exponential backoff.
steps:
  - phase: discovery
    steps:
      - "- [x] identify the shared summarizer entry point and all flush modes"
  - phase: implementation
    steps:
      - "- [x] add a testable shared cooldown controller with bounded backoff"
      - "- [x] apply the controller before every provider request and record rate limits"
      - "- [x] expose cooldown failures to manual progress while automatic paths retain pending work"
  - phase: validation
    steps:
      - "- [x] run focused tests, the full suite, and an isolated build"
---

# 054-shared-provider-rate-limit-gate

## Discovery
- [x] identify the shared summarizer entry point and all flush modes

## Implementation
- [x] add a testable shared cooldown controller with bounded backoff
- [x] apply the controller before every provider request and record rate limits
- [x] expose cooldown failures to manual progress while automatic paths retain pending work

## Validation
- [x] run focused tests, the full suite, and an isolated build
