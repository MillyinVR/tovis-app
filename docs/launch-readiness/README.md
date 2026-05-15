# TOVIS Launch Readiness

This directory tracks the launch-readiness work required before TOVIS is safe to ship to real users at scale.

The goal is not just to make the happy path work. The goal is to make the product safe, observable, recoverable, and handoff-ready for production use.

## Launch readiness standard

A launch-readiness item is not complete until it has:

- clear owner
- implementation status
- code or documentation reference
- test evidence
- rollback plan
- operational notes
- known risks or follow-up work

If any of those are missing, the item is not closed.

## Files

| File | Purpose |
|---|---|
| `checklist.md` | Master launch-readiness checklist across all phases. |
| `sprint-index.md` | Sprint-level status summary and completion tracking. |
| `status-rubric.md` | Shared definitions for TODO, IN PROGRESS, BLOCKED, DONE, and VERIFIED. |
| `rollback-template.md` | Template for rollback plans. |
| `test-evidence-template.md` | Template for recording test proof. |
| `handoff.md` | Enterprise handoff notes for operators, reviewers, and future maintainers. |

## Completion rule

Do not mark an item as `DONE` unless it is implemented and reviewed.

Do not mark an item as `VERIFIED` unless there is test evidence, manual verification evidence, or production/staging evidence linked in the checklist.

## Current launch posture

TOVIS has a strong core booking/session flow, but launch readiness still depends on completing operational, security, compliance, testing, and rollout work.

The remaining work should be tracked here so launch decisions are based on evidence, not memory.