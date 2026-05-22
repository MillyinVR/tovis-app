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

- [ ] All required documents exist.
- [ ] Each document has been reviewed by the engineering owner.
- [ ] Data classes cover user, client, Pro, booking, consultation, media, aftercare, payment, verification, notification, token, log, and admin/support data.
- [ ] Export/deletion process defines verification, retention exceptions, audit trail, and manual launch workflow.
- [ ] Private media incident runbook defines containment, impact assessment, user notification, and post-incident review.
- [ ] PII encryption roadmap defines what is hashed, what is encrypted, what is deferred, and how migrations should be phased.
- [ ] The launch gaps from each doc have been turned into tickets or explicitly accepted as launch risks.
- [ ] A named owner is assigned for security/privacy follow-up.
- [ ] A named owner is assigned for support/ops request handling.
- [ ] A named owner is assigned for legal/privacy review, even if that owner is temporarily the founder.

## Verification evidence log

Use this table during the sprint.

| Check | Owner | Status | Evidence link / notes |
|---|---|---:|---|
| Required docs exist |  | TODO |  |
| Data classification reviewed |  | TODO |  |
| Export/delete process reviewed |  | TODO |  |
| Private media incident runbook reviewed |  | TODO |  |
| PII encryption roadmap reviewed |  | TODO |  |
| Log redaction spot check completed |  | TODO |  |
| Analytics PII spot check completed |  | TODO |  |
| Token hashing proof completed |  | TODO |  |
| Storage private-media proof completed |  | TODO |  |
| Public search/profile privacy check completed |  | TODO |  |
| Admin/support access policy reviewed |  | TODO |  |
| Launch risks converted to tickets |  | TODO |  |

## 1. Documentation existence check

Run:

```bash
test -f docs/security/data-classification.md
test -f docs/security/user-data-export-delete.md
test -f docs/runbooks/private-media-incident.md
test -f docs/security/pii-encryption-roadmap.md