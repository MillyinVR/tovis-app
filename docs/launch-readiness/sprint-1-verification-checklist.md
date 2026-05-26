# Sprint 1 Verification Checklist

This checklist verifies that Sprint 1 privacy/security documentation is not just paperwork.

Each item should produce evidence: a command output, test result, screenshot, issue link, PR link, reviewed document, or written sign-off.

Sprint 1 covers:

- Data classification.
- User data export and deletion policy.
- Private media incident response.
- PII encryption roadmap.
- Launch verification checks for logs, analytics, token handling, media access, address privacy, and operational ownership.

## Status legend

| Status | Meaning |
|---|---|
| `TODO` | Not started or not proven. |
| `IN PROGRESS` | Partially complete or partially proven. |
| `DONE` | Complete with evidence. |
| `BLOCKED` | Waiting on a decision, owner, reviewer, or environment. |
| `ACCEPTED RISK` | Explicit founder/owner acceptance instead of completing before launch. |

## Proof columns

| Column | Meaning |
|---|---|
| `Implemented` | Document, code, or process exists. |
| `Tested locally` | Local command/test/review evidence exists. |
| `Tested in CI` | CI proof exists. |
| `Verified deployed` | Behavior has been verified in staging/production. |
| `Operationalized` | Owner, runbook, support process, alert, or recurring review exists. |

---

# Required documents

The following files should exist before Sprint 1 is considered complete.

| File | Purpose | Required before public launch | Status | Owner | Evidence |
|---|---|---:|---|---|---|
| `docs/security/data-classification.md` | Classifies TOVIS data by sensitivity, access rules, retention expectations, and launch gaps. | Yes | DONE | Tori | File exists. Needs explicit review/sign-off before final Sprint 1 sign-off. |
| `docs/security/user-data-export-delete.md` | Defines manual launch process for export, deletion, anonymization, media deletion, address deletion, and token revocation. | Yes | DONE | Tori | File exists. Implementation proof remains separate and open. |
| `docs/runbooks/private-media-incident.md` | Defines containment, investigation, notification, and recovery steps for private media exposure. | Yes | DONE | Tori | File exists. Support/ops review still needed. |
| `docs/security/pii-encryption-roadmap.md` | Defines phased hashing/encryption strategy for tokens, contact fields, addresses, notes, media, and key management. | Yes | DONE | Tori | File exists. Runtime implementation is incomplete. |
| `docs/security/contact-lookup-hash-threat-model.md` | Documents SHA-256 vs HMAC-SHA256 contact lookup hash decision and migration plan. | Yes | IN PROGRESS | Tori / Security reviewer needed | File exists. Decision documented; security review and HMAC migration remain future work. |
| `docs/launch-readiness/test-proof.md` | Records concrete proof runs, command output, commit SHAs, limitations, and evidence. | Yes | IN PROGRESS | Tori | File exists. Local evidence recorded; CI/staging/prod evidence still incomplete. |
| `docs/launch-readiness/storage-policy-proof.md` | Records storage/media private access proof and caveats. | Yes | IN PROGRESS | Tori | File exists. Update/delete proof caveat remains open. |

---

# Sprint 1 exit criteria

Sprint 1 is complete when every row below is `DONE`, `ACCEPTED RISK`, or explicitly deferred with owner approval.

| Exit criterion | Owner | Status | Implemented | Tested locally | Tested in CI | Verified deployed | Operationalized | Evidence / notes |
|---|---|---|---:|---:|---:|---:|---:|---|
| All required documents exist | Tori | DONE | Yes | N/A | N/A | N/A | Partial | Required docs exist, including `test-proof.md` and contact hash threat model. Some docs still need review/sign-off. |
| Each document has been reviewed by the engineering owner | Tori | TODO | Yes | No | N/A | N/A | No | Needs explicit review/sign-off entry with date. |
| Data classes cover user, client, Pro, booking, consultation, media, aftercare, payment, verification, notification, token, log, and admin/support data | Tori | DONE | Yes | N/A | N/A | N/A | Partial | Covered in data classification doc. |
| Export/deletion process defines verification, retention exceptions, audit trail, and manual launch workflow | Tori | IN PROGRESS | Yes | N/A | N/A | N/A | Partial | Policy doc exists; implementation proof and review/sign-off remain open. |
| Private media incident runbook defines containment, impact assessment, user notification, and post-incident review | Tori / Support-Ops reviewer needed | IN PROGRESS | Yes | N/A | N/A | N/A | Partial | Runbook exists; support/ops review still needed. |
| PII encryption roadmap defines what is hashed, what is encrypted, what is deferred, and how migrations should be phased | Tori / Security reviewer needed | IN PROGRESS | Yes | N/A | N/A | N/A | Partial | Roadmap exists; runtime AEAD/HMAC/identity encryption work remains incomplete. |
| Launch gaps from each doc have been turned into tickets or explicitly accepted as launch risks | Tori | TODO | Partial | No | N/A | N/A | No | Needs ticket conversion or risk acceptance. |
| Named owner assigned for security/privacy follow-up | Tori | IN PROGRESS | Partial | N/A | N/A | N/A | No | Temporary owner: Tori. Dedicated security/privacy reviewer still needed before public launch. |
| Named owner assigned for support/ops request handling | Tori / Support-Ops owner needed | TODO | No | N/A | N/A | N/A | No | Assign support/ops owner or document founder acceptance. |
| Named owner assigned for legal/privacy review, even if temporarily the founder | Tori / Legal-privacy reviewer needed | TODO | No | N/A | N/A | N/A | No | Assign reviewer or document founder risk acceptance. |
| Local proof record exists for completed Sprint 1 technical checks | Tori | IN PROGRESS | Yes | Yes | Partial | No | No | `test-proof.md` records local safe-logging, contact hash decision, and encrypted snapshot proof. CI/staging/prod evidence still incomplete. |

---

# Verification evidence log

Use this table during the sprint.

| Check | Owner | Status | Implemented | Tested locally | Tested in CI | Verified deployed | Operationalized | Evidence link / notes |
|---|---|---|---:|---:|---:|---:|---:|---|
| Required docs exist | Tori | DONE | Yes | N/A | N/A | N/A | Partial | `docs/security/data-classification.md`, `docs/security/user-data-export-delete.md`, `docs/runbooks/private-media-incident.md`, `docs/security/pii-encryption-roadmap.md`, `docs/security/contact-lookup-hash-threat-model.md`, `docs/launch-readiness/test-proof.md`, `docs/launch-readiness/storage-policy-proof.md`. |
| Data classification reviewed | Tori | TODO | Yes | No | N/A | N/A | No | Needs explicit review entry/date. |
| Export/delete process reviewed | Tori | TODO | Yes | No | N/A | N/A | No | Needs explicit review entry/date. |
| Private media incident runbook reviewed | Tori / Support-Ops reviewer needed | TODO | Yes | No | N/A | N/A | No | Needs support/ops review or founder risk acceptance. |
| PII encryption roadmap reviewed | Tori / Security reviewer needed | TODO | Yes | No | N/A | N/A | No | Needs security/privacy review. |
| Log redaction spot check completed | Tori | IN PROGRESS | Yes | Yes | No | No | Partial | Auth observability sanitizer covered by `lib/observability/authEvents.test.ts`; booking hot/sibling raw logging hardened in commit `8f2a424`; hold-create internal logger sanitized in PR #40/#41; full app-wide log surface review still needed. |
| Booking/session safe logging proof completed | Tori | DONE | Yes | Yes | No | No | Partial | Commit `8f2a424`. Grep returned no `console.error(..., error)` matches under `app/api/pro/bookings` and `app/api/bookings`; focused route suite passed locally: 11 files, 153 tests. Recorded in `docs/launch-readiness/test-proof.md`. |
| Hold-create internal logger sanitation completed | Tori | DONE | Yes | Yes | Unknown | No | Partial | PR #40 introduced sanitation; PR #41 corrected logger shape to keep `safeError(error)` outside `safeLogMeta(...)`. Covered by `lib/booking/writeBoundary.mobileRadius.test.ts`. |
| Analytics PII spot check completed | Tori | TODO | Unknown | No | No | No | No | Needs analytics/event payload review. |
| Token hashing proof completed | Tori | DONE | Yes | Yes | Unknown | No | No | `lib/clients/clientClaimLinks.test.ts`, `prisma/migrations/20260522010000_hash_pro_client_invite_tokens/migration.sql`, and ClientActionToken lookup tests. |
| SHA-256 vs HMAC contact hash decision documented | Tori / Security reviewer needed | IN PROGRESS | Yes | N/A | N/A | N/A | No | Decision recorded in `docs/security/contact-lookup-hash-threat-model.md`. Code still uses SHA-256; HMAC-SHA256 migration is a future ticket. Recorded in `docs/launch-readiness/test-proof.md`. |
| Storage private-media proof completed | Tori | IN PROGRESS | Yes | Partial | No | No | Partial | `docs/launch-readiness/storage-policy-proof.md`, media authorization/render URL tests, admin verification-doc signed URL tests. Update/delete caveat remains open. |
| Storage media-private update/delete proof completed | Tori | TODO | No | No | No | No | No | Anonymous/authenticated direct update/delete proof still missing. |
| Public search/profile privacy check completed | Tori | TODO | Unknown | No | No | No | No | Needs manual review of public profile/search payloads. |
| Admin/support access policy reviewed | Tori / Support-Ops reviewer needed | IN PROGRESS | Partial | Partial | Unknown | No | No | Scoped admin permission checks exist for moderation and verification-doc open paths; policy review still needed. |
| ClientAddress encrypted writes verified | Tori | DONE | Yes | Yes | Unknown | No | No | Create/update paths write address privacy fields. |
| ProfessionalLocation encrypted writes verified | Tori | DONE | Yes | Yes | Unknown | No | No | Create/update/onboarding/offerings paths write address privacy fields. |
| BookingHold/Booking encrypted snapshot writes verified | Tori | IN PROGRESS | Yes | Yes | Yes | No | No | PR #40 dual-wrote legacy + dedicated encrypted snapshot columns. PR #41 corrected the contract so legacy plaintext snapshots are not copied into dedicated encrypted columns and approx coordinates are coarsened. Local proof: focused write-boundary suite passed 3 files / 31 tests; `pnpm vitest run lib/booking` passed 41 files / 371 tests; `pnpm typecheck` passed; PR checks passed. Historical backfill, read cut-over, and legacy column contraction remain pending. |
| Address read/decrypt helper seam verified | Tori | TODO | Partial | No | No | No | No | Write helper exists; central decrypt/read helper does not. |
| Pro session state refresh proof completed | Tori | TODO | No | No | No | No | No | No session state endpoint or polling UI yet. |
| Test proof record created | Tori | IN PROGRESS | Yes | Yes | Partial | No | No | File exists with safe-logging proof, contact-hash decision, and encrypted snapshot proof. CI/staging/prod evidence not yet complete. |
| Launch risks converted to tickets | Tori | TODO | Partial | No | N/A | N/A | No | Remaining gaps need tracker tickets or explicit risk acceptance. |

---

# 1. Documentation existence check

Run:

```bash
test -f docs/security/data-classification.md
test -f docs/security/user-data-export-delete.md
test -f docs/runbooks/private-media-incident.md
test -f docs/security/pii-encryption-roadmap.md
test -f docs/security/contact-lookup-hash-threat-model.md
test -f docs/launch-readiness/test-proof.md
test -f docs/launch-readiness/storage-policy-proof.md