# Launch Readiness Status Rubric

Use this rubric for every item in the launch-readiness checklist.

## Status values

| Status | Meaning |
|---|---|
| `TODO` | The work has not started. |
| `IN PROGRESS` | Work has started but is not ready for review. |
| `BLOCKED` | Work cannot continue until a decision, dependency, credential, design choice, or external action is resolved. |
| `READY FOR REVIEW` | Implementation is complete and waiting for review. |
| `DONE` | Work is merged or documented, reviewed, and has basic test evidence. |
| `VERIFIED` | Work has proof from tests, staging, production, or manual verification and is safe to treat as closed for launch readiness. |
| `DEFERRED` | Work is intentionally out of launch scope, with a named reason and follow-up owner. |

## Required fields for checklist items

Every checklist item must include:

| Field | Required | Notes |
|---|---:|---|
| Owner | Yes | Person responsible for closing the item. |
| Status | Yes | Must use one of the status values above. |
| Priority | Yes | Use `P0`, `P1`, `P2`, or `P3`. |
| Source | Yes | Audit, issue, PR, incident, product requirement, or engineering decision. |
| Implementation reference | Yes if started | Link to file, PR, issue, or doc. |
| Test evidence | Yes for `DONE` or `VERIFIED` | Unit, integration, E2E, manual QA, staging, production, or load-test evidence. |
| Rollback notes | Yes for runtime changes | Required for code, database, config, provider, or infrastructure changes. |
| Known risks | Yes | State what is still unsafe, unknown, or intentionally deferred. |

## Completion rules

### `DONE`

An item may be marked `DONE` only when:

1. The implementation or documentation exists.
2. The work has been reviewed.
3. Basic test evidence or manual verification exists.
4. Rollback notes exist when the item changes runtime behavior.
5. Any follow-up work is explicitly listed.

### `VERIFIED`

An item may be marked `VERIFIED` only when:

1. The item is already `DONE`.
2. Evidence proves it behaves correctly in the intended environment.
3. The evidence is linked or summarized in the checklist.
4. Any remaining risk is documented.

## Priority values

| Priority | Meaning |
|---|---|
| `P0` | Must be complete before public launch. |
| `P1` | Should be complete before public launch unless explicitly deferred. |
| `P2` | Important for scale, enterprise handoff, or operational maturity. |
| `P3` | Nice-to-have or post-launch polish. |

## Safety rule

If an item affects auth, booking state, payment state, media access, notifications, personal data, or provider integrations, it cannot be closed without test evidence.