---
name: 056-rate-limit-retry-and-frontier-metrics
description: Correct manual rate-limit retry behavior and ensure cancellation frontier metadata covers only the contiguous completed prefix.
steps:
  - phase: discovery
    steps:
      - "- [x] confirm rate-limit retry is blocked by the shared cooldown and locate frontier aggregation"
      - "- [x] choose cooldown-wait retry behavior with cancellable overlay feedback"
  - phase: tests
    steps:
      - "- [x] add failing tests for cooldown-aware retry/backoff and contiguous frontier metrics"
  - phase: implementation
    steps:
      - "- [x] implement cancellable cooldown waiting before the manual retry"
      - "- [x] retain exponential backoff until a successful provider request"
      - "- [x] aggregate persisted frontier metrics only from the contiguous frontier prefix"
  - phase: validation
    steps:
      - "- [x] run focused tests, full unit tests, and isolated build/package checks"
---

# 056-rate-limit-retry-and-frontier-metrics

## Discovery
- [x] confirm rate-limit retry is blocked by the shared cooldown and locate frontier aggregation
- [x] choose cooldown-wait retry behavior with cancellable overlay feedback

## Tests
- [x] add failing tests for cooldown-aware retry/backoff and contiguous frontier metrics

## Implementation
- [x] implement cancellable cooldown waiting before the manual retry
- [x] retain exponential backoff until a successful provider request
- [x] aggregate persisted frontier metrics only from the contiguous frontier prefix

## Validation
- [x] run focused tests, full unit tests, and isolated build/package checks
