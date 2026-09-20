# Project Guidance

This repository is a Pi coding-agent extension that prunes tool-call trees before the next request is sent.

## Working style
- Keep changes small, focused, and reversible.
- Read existing files before editing them.
- Preserve unrelated user work.
- Keep source, tests, and user-facing documentation aligned.

## Planning and backlog
- Use the `planning` skill for a discrete feature that spans design, implementation, and verification, or whenever the user explicitly asks for a plan. The skill is the source of truth for plan format, filenames, and checklist maintenance.
- Keep one active plan per feature; record related fixes and refinements in that plan rather than opening another.
- Focused fixes, commits, and `TODO.md` updates do not need a plan unless they start a new feature.
- `TODO.md` is the committed backlog for future work. Add or reprioritize ideas there; open a feature plan only when implementation begins.
- `TODO.md` is a checkbox backlog. When an existing item is implemented and the user has manually verified its behavior, change it from `[ ]` to `[x]`; implementation and automated checks alone keep it open.
- Do not add completed work retroactively to `TODO.md`; use feature plans and Git history for that record.

## Build and tests
- Run `npm test` for unit tests. New behavior fixes need a regression test when there is a suitable seam.
- For plan-driven feature work, use TDD with a small set of representative positive and negative-path unit tests before implementation. Optimize for fast feedback, not exhaustive coverage.
- Run `npm run build` after extension source changes; it regenerates the ignored local `dist/` bundle used by Pi.
- Run `npm run check` before release/package validation.
- Keep `dist/` untracked; commit TypeScript source, tests, docs, and plans instead.

## Documentation boundaries
- `README.md` is the source of truth for user-facing commands, settings, defaults, and TUI behavior.
- `AGENTS.md` contains agent workflow rules and stable source navigation only; do not duplicate volatile user-facing behavior here.
- `SPEC.md` is the source of truth for cross-module invariants and lifecycle contracts; read it before changing core capture, flush, frontier, indexing, or recovery behavior.

## Code map
- `index.ts` wires capture, flushing, indexing, session persistence, and Pi events.
- `src/types.ts` defines shared domain/config types; `src/config.ts` persists extension settings.
- `src/batch-capture.ts`, `src/summarizer.ts`, `src/indexer.ts`, and `src/pruner.ts` implement the core pruning pipeline.
- `src/commands.ts` owns `/pruner` commands and TUI components; `src/manual-prune-scheduler.ts` contains the testable bounded manual scheduler.
- `src/context-prune-tool.ts`, `src/query-tool.ts`, `src/reminder.ts`, `src/stats.ts`, and `src/tree-browser.ts` provide supporting Pi features.
- `test/` contains Vitest unit tests.
