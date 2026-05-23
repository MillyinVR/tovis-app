# Sprint 1 Verification Checklist

This checklist verifies that Sprint 1 privacy/security documentation is not just paperwork. Each item should produce evidence: a command output, test result, screenshot, issue link, PR link, reviewed document, or written sign-off.

Sprint 1 covers:

- Data classification.
- User data export and deletion policy.
- Private media incident response.
- PII encryption roadmap.
- Launch verification checks for logs, analytics, token handling, media access, and operational ownership.

## Required documents

The following files should exist before Sprint 1 is considered complete:

| File | Purpose | Required before public launch |
|---|---|---:|
| `docs/security/data-classification.md` | Classifies TOVIS data by sensitivity, access rules, retention expectations, and launch gaps. | Yes |
| `docs/security/user-data-export-delete.md` | Defines manual launch process for export, deletion, anonymization, media deletion, address deletion, and token revocation. | Yes |
| `docs/runbooks/private-media-incident.md` | Defines containment, investigation, notification, and recovery steps for private media exposure. | Yes |
| `docs/security/pii-encryption-roadmap.md` | Defines phased hashing/encryption strategy for tokens, contact fields, addresses, notes, media, and key management. | Yes |

## Sprint 1 exit criteria

Sprint 1 is complete when:

- [x] All required documents exist.
- [ ] Each document has been reviewed by the engineering owner.
- [x] Data classes cover user, client, Pro, booking, consultation, media, aftercare, payment, verification, notification, token, log, and admin/support data.
- [x] Export/deletion process defines verification, retention exceptions, audit trail, and manual launch workflow.
- [x] Private media incident runbook defines containment, impact assessment, user notification, and post-incident review.
- [x] PII encryption roadmap defines what is hashed, what is encrypted, what is deferred, and how migrations should be phased.
- [ ] The launch gaps from each doc have been turned into tickets or explicitly accepted as launch risks.
- [ ] A named owner is assigned for security/privacy follow-up.
- [ ] A named owner is assigned for support/ops request handling.
- [ ] A named owner is assigned for legal/privacy review, even if that owner is temporarily the founder.

## Verification evidence log

Use this table during the sprint.

| Check | Owner | Status | Evidence link / notes |
|---|---|---:|---|
| Required docs exist |  | DONE | `docs/security/data-classification.md`, `docs/security/user-data-export-delete.md`, `docs/runbooks/private-media-incident.md`, `docs/security/pii-encryption-roadmap.md` |
| Data classification reviewed |  | TODO |  |
| Export/delete process reviewed |  | TODO |  |
| Private media incident runbook reviewed |  | TODO |  |
| PII encryption roadmap reviewed |  | TODO |  |
| Log redaction spot check completed |  | IN PROGRESS | Auth observability sanitizer covered by `lib/observability/authEvents.test.ts`; all log surfaces still need review. |
| Analytics PII spot check completed |  | TODO |  |
| Token hashing proof completed |  | DONE | `lib/clients/clientClaimLinks.test.ts`, `prisma/migrations/20260522010000_hash_pro_client_invite_tokens/migration.sql`, ClientActionToken lookup tests. |
| Storage private-media proof completed |  | DONE | `docs/launch-readiness/storage-policy-proof.md`, media authorization/render URL tests, admin verification-doc signed URL tests. |
| Public search/profile privacy check completed |  | TODO |  |
| Admin/support access policy reviewed |  | IN PROGRESS | Scoped admin permission checks exist for moderation and verification-doc open paths; policy review still needed. |
| Launch risks converted to tickets |  | TODO |  |

## 1. Documentation existence check

Run:

```bash
test -f docs/security/data-classification.md
test -f docs/security/user-data-export-delete.md
test -f docs/runbooks/private-media-incident.md
test -f docs/security/pii-encryption-roadmap.md
