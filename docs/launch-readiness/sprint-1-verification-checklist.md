# Sprint 1 Verification Checklist
This checklist verifies that Sprint 1 privacy/security documentation is not just paperwork. Each item should produce evidence: a command output, test result, screenshot, issue link, PR link, reviewed document, or written sign-off.
Sprint 1 covers:
- Data classification.
- User data export and deletion policy.
- Private media incident response.
- PII encryption roadmap.
- Launch verification checks for logs, analytics, token handling, media access, and operational ownership.
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
The following files should exist before Sprint 1 is considered complete:
| File | Purpose | Required before public launch | Status | Owner | Evidence |
|---|---|---:|---|---|---|
| `docs/security/data-classification.md` | Classifies TOVIS data by sensitivity, access rules, retention expectations, and launch gaps. | Yes | DONE | Tori | File exists. |
| `docs/security/user-data-export-delete.md` | Defines manual launch process for export, deletion, anonymization, media deletion, address deletion, and token revocation. | Yes | DONE | Tori | File exists. |
| `docs/runbooks/private-media-incident.md` | Defines containment, investigation, notification, and recovery steps for private media exposure. | Yes | DONE | Tori | File exists. |
| `docs/security/pii-encryption-roadmap.md` | Defines phased hashing/encryption strategy for tokens, contact fields, addresses, notes, media, and key management. | Yes | DONE | Tori | File exists. |
---
# Sprint 1 exit criteria
Sprint 1 is complete when:
| Exit criterion | Owner | Status | Implemented | Tested locally | Tested in CI | Verified deployed | Operationalized | Evidence / notes |
|---|---|---|---:|---:|---:|---:|---:|---|
| All required documents exist | Tori | DONE | Yes | N/A | N/A | N/A | Partial | Required docs exist. |
| Each document has been reviewed by the engineering owner | Tori | TODO | Yes | No | N/A | N/A | No | Needs explicit review/sign-off. |
| Data classes cover user, client, Pro, booking, consultation, media, aftercare, payment, verification, notification, token, log, and admin/support data | Tori | DONE | Yes | N/A | N/A | N/A | Partial | Covered in data classification doc. |
| Export/deletion process defines verification, retention exceptions, audit trail, and manual launch workflow | Tori | DONE | Yes | N/A | N/A | N/A | Partial | Covered in export/delete doc. |
| Private media incident runbook defines containment, impact assessment, user notification, and post-incident review | Tori / Support-Ops reviewer needed | DONE | Yes | N/A | N/A | N/A | Partial | Runbook exists; owner review still needed. |
| PII encryption roadmap defines what is hashed, what is encrypted, what is deferred, and how migrations should be phased | Tori / Security reviewer needed | DONE | Yes | N/A | N/A | N/A | Partial | Roadmap exists; runtime follow-through incomplete. |
| Launch gaps from each doc have been turned into tickets or explicitly accepted as launch risks | Tori | TODO | Partial | No | N/A | N/A | No | Needs ticket conversion or risk acceptance. |
| Named owner assigned for security/privacy follow-up | Tori | IN PROGRESS | Partial | N/A | N/A | N/A | No | Temporary owner: Tori. Dedicated security/privacy owner still needed before public launch. |
| Named owner assigned for support/ops request handling | Tori / Support-Ops owner needed | TODO | No | N/A | N/A | N/A | No | Assign support/ops owner or founder acceptance. |
| Named owner assigned for legal/privacy review, even if temporarily the founder | Tori / Legal-privacy reviewer needed | TODO | No | N/A | N/A | N/A | No | Assign reviewer or document founder risk acceptance. |
---
# Verification evidence log
Use this table during the sprint.
| Check | Owner | Status | Implemented | Tested locally | Tested in CI | Verified deployed | Operationalized | Evidence link / notes |
|---|---|---|---:|---:|---:|---:|---:|---|
| Required docs exist | Tori | DONE | Yes | N/A | N/A | N/A | Partial | `docs/security/data-classification.md`, `docs/security/user-data-export-delete.md`, `docs/runbooks/private-media-incident.md`, `docs/security/pii-encryption-roadmap.md` |
| Data classification reviewed | Tori | TODO | Yes | No | N/A | N/A | No | Needs explicit review entry/date. |
| Export/delete process reviewed | Tori | TODO | Yes | No | N/A | N/A | No | Needs explicit review entry/date. |
| Private media incident runbook reviewed | Tori / Support-Ops reviewer needed | TODO | Yes | No | N/A | N/A | No | Needs support/ops review or founder risk acceptance. |
| PII encryption roadmap reviewed | Tori / Security reviewer needed | TODO | Yes | No | N/A | N/A | No | Needs security/privacy review. |
| Log redaction spot check completed | Tori | IN PROGRESS | Yes | Yes | No | No | Partial | Auth observability sanitizer covered by `lib/observability/authEvents.test.ts`; booking hot/sibling raw logging hardened in commit `8f2a424`; all log surfaces still need full review. |
| Booking/session safe logging proof completed | Tori | DONE | Yes | Yes | No | No | Partial | Grep returned no `console.error(..., error)` matches under `app/api/pro/bookings` and `app/api/bookings`; focused route suite passed locally: 11 files, 153 tests. |
| Analytics PII spot check completed | Tori | TODO | Unknown | No | No | No | No | Needs analytics/event payload review. |
| Token hashing proof completed | Tori | DONE | Yes | Yes | Unknown | No | No | `lib/clients/clientClaimLinks.test.ts`, `prisma/migrations/20260522010000_hash_pro_client_invite_tokens/migration.sql`, ClientActionToken lookup tests. |
| Storage private-media proof completed | Tori | IN PROGRESS | Yes | Partial | No | No | Partial | `docs/launch-readiness/storage-policy-proof.md`, media authorization/render URL tests, admin verification-doc signed URL tests. Update/delete caveat remains open. |
| Storage media-private update/delete proof completed | Tori | TODO | No | No | No | No | No | Anonymous/authenticated direct update/delete proof still missing. |
| Public search/profile privacy check completed | Tori | TODO | Unknown | No | No | No | No | Needs manual review of public profile/search payloads. |
| Admin/support access policy reviewed | Tori / Support-Ops reviewer needed | IN PROGRESS | Partial | Partial | Unknown | No | No | Scoped admin permission checks exist for moderation and verification-doc open paths; policy review still needed. |
| Launch risks converted to tickets | Tori | TODO | Partial | No | N/A | N/A | No | Remaining gaps need tracker tickets or explicit risk acceptance. |
| SHA-256 vs HMAC contact hash decision documented | Tori / Security reviewer needed | TODO | No | No | No | No | No | `lib/security/crypto/hashLookup.ts` uses SHA-256; create `docs/security/contact-lookup-hash-threat-model.md`. |
| ClientAddress encrypted writes verified | Tori | DONE | Yes | Yes | Unknown | No | No | Create/update paths write address privacy fields. |
| ProfessionalLocation encrypted writes verified | Tori | DONE | Yes | Yes | Unknown | No | No | Create/update/onboarding/offerings paths write address privacy fields. |
| BookingHold/Booking encrypted snapshot writes verified | Tori | IN PROGRESS | Partial | Partial | Unknown | No | No | Envelope is written into legacy snapshot JSON columns; dedicated encrypted snapshot columns are not written. |
| Address read/decrypt helper seam verified | Tori | TODO | Partial | No | No | No | No | Write helper exists; central decrypt/read helper does not. |
| Pro session state refresh proof completed | Tori | TODO | No | No | No | No | No | No session state endpoint or polling UI yet. |
| Test proof record created | Tori | TODO | No | No | No | No | No | Create `docs/launch-readiness/test-proof.md`. |
---
# 1. Documentation existence check
Run:
```bash
test -f docs/security/data-classification.md
test -f docs/security/user-data-export-delete.md
test -f docs/runbooks/private-media-incident.md
test -f docs/security/pii-encryption-roadmap.md

Expected result:

All commands exit 0.

Evidence:

Status: DONE
Owner: Tori
Notes: Required docs exist.

⸻

2. Review required privacy/security docs

Review these files manually:

docs/security/data-classification.md
docs/security/user-data-export-delete.md
docs/runbooks/private-media-incident.md
docs/security/pii-encryption-roadmap.md

For each document, record:

Reviewer:
Date:
Decision: approved / needs changes / accepted risk
Notes:
Follow-up tickets:

Current status:

Document	Owner	Reviewer	Status	Notes
docs/security/data-classification.md	Tori	TBD	TODO	Needs explicit review/sign-off.
docs/security/user-data-export-delete.md	Tori	TBD	TODO	Needs explicit review/sign-off.
docs/runbooks/private-media-incident.md	Tori	Support/Ops reviewer needed	TODO	Needs support/ops review or founder acceptance.
docs/security/pii-encryption-roadmap.md	Tori	Security/privacy reviewer needed	TODO	Needs security/privacy review and runtime ticket linkage.

⸻

3. Log redaction verification

Goal:

Confirm sensitive data is not logged raw.

Sensitive data includes:

raw Error objects
raw request bodies
tokens
emails
phones
addresses
signed URLs
private media paths
private notes
consultation note bodies
aftercare note bodies
payment secrets

Known local evidence:

Commit: 8f2a424 Harden booking route error logging
Focused suite: 11 files, 153 tests passed locally
Typecheck: passed locally
Grep: no raw console.error(..., error) matches under booking route scope

Recommended command:

grep -RIn \
  --exclude-dir=node_modules \
  --exclude-dir=.next \
  --exclude-dir=.git \
  --include='route.ts' \
  "console\.error([^,]*,[[:space:]]*error[)]" app/api/pro/bookings app/api/bookings

Expected result:

No matches.

Additional command:

pnpm vitest run \
  app/api/pro/bookings/route.test.ts \
  'app/api/pro/bookings/[id]/route.test.ts' \
  'app/api/pro/bookings/[id]/cancel/route.test.ts' \
  'app/api/pro/bookings/[id]/final-review/route.test.ts' \
  'app/api/pro/bookings/[id]/consultation-services/route.test.ts' \
  'app/api/pro/bookings/[id]/checkout/mark-paid/route.test.ts' \
  'app/api/pro/bookings/[id]/checkout/waive/route.test.ts' \
  'app/api/pro/bookings/[id]/invite/route.test.ts' \
  'app/api/pro/bookings/[id]/rebook/route.test.ts' \
  'app/api/pro/bookings/[id]/session/finish/route.test.ts' \
  'app/api/bookings/[id]/reschedule/route.test.ts'

Latest local evidence:

Status: DONE for booking/session route scope
Owner: Tori
Result: 11 test files passed, 153 tests passed
Commit: 8f2a424
Remaining scope: Full app-wide log surface review still needed.

⸻

4. Analytics PII spot check

Goal:

Confirm analytics/events do not include raw PII.

Check for:

email
phone
address
full name
tokens
signed URLs
private media paths
payment secrets
consultation note bodies
aftercare note bodies

Suggested search:

grep -RIn \
  --exclude-dir=node_modules \
  --exclude-dir=.next \
  --exclude-dir=.git \
  "analytics\|track\|event\|capture" app lib

Status:

TODO
Owner: Tori
Evidence: Not completed yet.

⸻

5. Token hashing proof

Goal:

Confirm tokens are not stored raw for new/primary invite and action-token flows.

Known evidence:

lib/clients/clientClaimLinks.test.ts
prisma/migrations/20260522010000_hash_pro_client_invite_tokens/migration.sql
ClientActionToken lookup tests

Status:

DONE
Owner: Tori
Verified deployed: No
Operationalized: No

Remaining note:

Legacy/deprecated fields may remain for migration/backward compatibility. They must not be used as active primary lookup paths unless explicitly documented.

⸻

6. Storage private-media proof

Goal:

Confirm private media cannot be directly accessed outside authorized server-mediated paths.

Known evidence:

docs/launch-readiness/storage-policy-proof.md
media authorization/render URL tests
admin verification-doc signed URL tests

Current status:

IN PROGRESS
Owner: Tori

Completed:

[DONE] Policy doc exists.
[DONE] Read/list proof mostly exists.
[DONE] Server-mediated signed URL authorization tests exist.

Still TODO:

[TODO] Anonymous direct update media-private denied.
[TODO] Anonymous direct delete media-private denied.
[TODO] Authenticated direct update media-private denied unless intentionally allowed.
[TODO] Authenticated direct delete media-private denied unless intentionally allowed.

⸻

7. Public search/profile privacy check

Goal:

Confirm public-facing search/profile payloads do not expose private client, Pro, booking, media, notes, verification, or address data.

Check:

public search API responses
public Pro profile pages
public service/offering payloads
map/search location precision
image/media URLs
verification/license fields
client data leakage

Status:

TODO
Owner: Tori
Evidence: Not completed yet.

⸻

8. Admin/support access policy review

Goal:

Confirm admin/support access is scoped, justified, auditable, and documented.

Known evidence:

Scoped admin permission checks exist for moderation and verification-doc open paths.

Still needed:

[TODO] Explicit policy review.
[TODO] Owner assignment.
[TODO] Support/ops workflow.
[TODO] Audit/logging expectations.

Status:

IN PROGRESS
Owner: Tori / Support-Ops reviewer needed

⸻

9. Contact lookup hash decision

Goal:

Document whether contact lookup hashes stay as SHA-256 for beta or move to HMAC-SHA256 before broader launch.

Known state:

lib/security/crypto/hashLookup.ts uses plain SHA-256.
No docs/security/contact-lookup-hash-threat-model.md exists yet.

Required doc:

docs/security/contact-lookup-hash-threat-model.md

Decision options:

Option	Pros	Cons
Keep SHA-256 for beta	Simple; already implemented.	DB-only attacker can test known emails/phones against hashes.
Move to HMAC-SHA256	Stronger if DB leaks without app secret.	Requires secret management, migration/backfill, and careful lookup updates.

Status:

TODO
Owner: Tori / Security reviewer needed
Launch requirement: Decision must be documented before broader public launch.

⸻

10. Address encryption runtime verification

Goal:

Confirm address privacy fields are not just schema decoration.

Known state:

Area	Status	Notes
ClientAddress encrypted writes	DONE	Create/update paths write address privacy data.
ProfessionalLocation encrypted writes	DONE	Create/update/onboarding/offerings paths write address privacy data.
BookingHold/Booking snapshot encryption	IN PROGRESS	Envelope exists, but dedicated encrypted snapshot columns are not written.
Address read/decrypt helper seam	TODO	Write helper exists; central decrypt/read helper missing.

Required follow-up:

[TODO] Decide whether dedicated Booking/BookingHold encrypted snapshot columns should be written or removed.
[TODO] If keeping columns, wire writes to encryptedClientAddressSnapshotJson and encryptedLocationAddressSnapshotJson.
[TODO] Keep legacy snapshot fields only as dual-write/expand-phase compatibility fields.
[TODO] Add read/decrypt helper seam before real cipher migration.

Owner:

Tori

⸻

11. Launch risks converted to tickets

Goal:

Every remaining launch gap should either have a tracker ticket or be explicitly accepted as a launch risk.

Current required tickets:

Document SHA-256 vs HMAC contact hash decision.
Wire BookingHold/Booking dedicated encrypted snapshot columns.
Add centralized address read/decrypt helpers.
Add Pro session state endpoint.
Add active-session polling to Pro session UI.
Finish storage media-private update/delete proof.
Create test-proof.md and record proof suite.
Add full lifecycle action regression suite.
Add booking finalize load test.
Add availability load test.
Add media metadata/load test.
Add Stripe webhook replay storm test.
Add Redis/provider outage chaos rehearsals.
Add go/no-go doc.
Add private beta checklist.
Add public rollout checklist.
Add risk register.
Add production dashboard/alert setup.
Assign support/ops owner.
Assign legal/privacy reviewer or founder risk acceptance.

Status:

TODO
Owner: Tori
Evidence: Tracker ticket links needed.

⸻

12. Sprint 1 sign-off

Sprint 1 cannot be considered fully signed off until this section is completed.

Role	Owner	Status	Date	Notes
Engineering owner	Tori	IN PROGRESS	TBD	Required docs exist; explicit review still needed.
Security/privacy owner	Tori / Security reviewer needed	TODO	TBD	Assign reviewer or document founder risk acceptance.
Support/ops owner	Tori / Support-Ops owner needed	TODO	TBD	Assign owner before beta.
Legal/privacy reviewer	Tori / Legal-privacy reviewer needed	TODO	TBD	Assign reviewer or document founder risk acceptance.
Founder risk acceptance	Tori	TODO	TBD	Use only for risks intentionally accepted before private beta/public launch.

Final Sprint 1 status:

IN PROGRESS

Reason:

Required docs exist and several technical proofs are complete, but owner review, sign-off, analytics/public-profile checks, storage update/delete proof, and ticket/risk conversion are still open.
Then run this after pasting both files:
```bash
git diff --check
pnpm typecheck
git status
git diff --stat