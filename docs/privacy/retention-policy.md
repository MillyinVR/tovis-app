# Phase 1 Privacy Retention Policy

## Status

Phase 1 retention policy is documented for pre-launch privacy readiness.

This document defines the current retention, export, and deletion/anonymization decisions for user privacy workflows. It is intentionally conservative: privacy-sensitive data should be deleted or anonymized unless there is a clear product, operational, fraud-prevention, dispute-resolution, tax/accounting, or safety reason to retain it.

This policy is not a substitute for legal review. Before public launch, final retention windows should be reviewed against the company’s published Terms, Privacy Policy, support workflows, and applicable legal/compliance requirements.

## Scope

This policy covers Phase 1 privacy behavior for:

- User accounts.
- Client profiles.
- Professional profiles.
- Client addresses.
- Professional locations.
- Bookings and booking holds.
- Messages and conversations.
- Aftercare summaries.
- Notification deliveries.
- Attribution events.
- Admin action logs.
- Media/storage objects.
- Export/delete workflows.

## Guiding rules

1. Do not hard-delete operational records that are needed for integrity, accounting, disputes, fraud prevention, safety, or audit history.
2. Do anonymize direct user identifiers when an account is deleted.
3. Do delete short-lived or user-owned convenience records when they are no longer needed.
4. Do not retain raw plaintext PII in audit logs or long-lived diagnostic records.
5. Do not keep storage objects just because database rows were anonymized. Storage byte deletion requires an explicit storage write boundary.
6. When full deletion could damage another user’s legitimate record, prefer anonymization or unlinking.

## Current Phase 1 decision summary

| Area | Phase 1 decision | Implementation status |
|---|---|---|
| User account | Anonymize, do not hard-delete user row. | Implemented foundation. |
| Client profile | Anonymize identity/contact fields; delete supported child records. | Implemented foundation. |
| Professional profile | Anonymize supported identity/contact fields where applicable; preserve operational history. | Partial/foundation. |
| Client addresses | Delete rows owned by deleted/anonymized user. | Implemented foundation. |
| Professional locations | Delete or anonymize according to ownership and booking dependency constraints. | Foundation present; booking dependency policy still deferred. |
| Booking holds | Delete expired/temporary hold records. | Implemented foundation. |
| Bookings | Preserve booking record for operational/accounting/dispute history; anonymize user-identifying snapshots when policy is implemented. | Policy defined; implementation deferred. |
| Messages | Preserve conversation integrity where needed; anonymize or delete participant-authored content according to ownership/retention rules. | Policy defined; implementation deferred. |
| Aftercare summaries | Preserve only if needed for service history; anonymize/delete user-identifying fields. | Deferred traversal. |
| Notification deliveries | Preserve delivery metadata where needed; avoid retaining message body/contact PII. | Deferred traversal. |
| Attribution events | Preserve aggregate analytics where possible; unlink or anonymize user identity. | Deferred traversal. |
| Admin action logs | Preserve audit events; redact payloads before persistence. | Redaction implemented/tested; export/delete mapping deferred. |
| Media/storage objects | Delete user-owned private storage bytes when deletion boundary exists. | Deferred storage write boundary. |
| Tenant-level data | Out of Phase 1; belongs to WS-1 tenant work. | Deferred. |

## User account deletion/anonymization

### Decision

When a user requests account deletion, Phase 1 should anonymize the user row instead of hard-deleting it.

### Rationale

The user row may be referenced by bookings, audit records, messages, professional/client profiles, or operational history. Hard deletion can break referential integrity or erase records needed for fraud prevention, disputes, accounting, safety, or support.

### Required behavior

On delete/anonymization:

- Clear direct contact fields where supported.
- Clear legacy SHA-256 lookup hashes.
- Clear HMAC v2 lookup hashes and key versions.
- Replace password with a disabled/deleted-user sentinel.
- Disable future login.
- Preserve non-identifying IDs where required for relational integrity.
- Avoid preserving raw email, phone, names, tokens, private URLs, or address data unless explicitly required and documented.

### Current implementation notes

lib/privacy/deleteUserData.ts currently provides the foundation for user/profile anonymization and clears both legacy and HMAC v2 lookup fields.

## Client profile retention

### Decision

Client profile identity/contact fields should be anonymized when the owning user is deleted. Client-owned convenience records, such as saved addresses and temporary action tokens, should be deleted where supported.

### Required behavior

Delete or clear:

- Client addresses.
- Client action tokens.
- Contact lookup hashes and key versions.
- Direct contact fields where supported.
- User-identifying profile fields where supported.

Preserve only:

- Records needed for booking history, dispute resolution, accounting, safety, or audit integrity.

### Deferred work

Any client-linked records not currently traversed by deleteUserData remain deferred until their ownership and retention rules are implemented.

## Professional profile retention

### Decision

Professional profile deletion/anonymization must preserve operational history needed for bookings, audit, financial records, reviews, disputes, and marketplace integrity.

### Required behavior

For Phase 1:

- Do not hard-delete professional history that could break booking or audit records.
- Clear direct contact/identity fields where safe.
- Delete or anonymize private media/storage objects where supported.
- Preserve non-identifying operational records as needed.

### Deferred work

Professional deletion is still tied to broader tenant/workspace and marketplace lifecycle decisions. Tenant-level export/delete belongs to WS-1 tenant work.

## Client addresses

### Decision

Client saved addresses should be deleted during user deletion unless they are embedded in historical booking snapshots that must be retained for operational reasons.

### Required behavior

Delete:

- ClientAddress rows owned by the deleted/anonymized client.

Retain/anonymize:

- Historical booking address snapshots only where needed for operational, accounting, dispute, or safety reasons.

### Current implementation notes

Client address row deletion exists in the Phase 1 export/delete foundation.

## Professional locations

### Decision

Professional locations are operational records. They may be deleted when safe, but locations tied to historical bookings may require preservation or anonymization rather than hard deletion.

### Required behavior

- Delete draft/unused locations when safe.
- Preserve or anonymize locations referenced by bookings, disputes, or operational history.
- Do not retain raw address PII in long-lived audit payloads.
- Use address encryption fields for protected address storage.

### Deferred work

Booking dependency behavior for location deletion/anonymization remains deferred until booking retention is fully implemented.

## Booking holds

### Decision

Booking holds are temporary reservation records and should be deleted when no longer needed.

### Required behavior

- Delete booking holds associated with a deleted/anonymized user when safe.
- Expired holds should not be retained as long-lived user history.

### Current implementation notes

Booking hold deletion exists in the Phase 1 export/delete foundation.

## Bookings

### Decision

Booking records should generally be retained for operational history, accounting, refunds/chargebacks, disputes, fraud prevention, safety, and support.

However, user-identifying fields inside retained booking records should be anonymized or minimized when a user is deleted, unless retention is required for a documented reason.

### Required retention behavior

Retain:

- Booking ID.
- Service/category/professional references needed for operational history.
- Status and lifecycle timestamps.
- Payment/accounting references required for financial reconciliation.
- Non-identifying operational metadata.

Anonymize or clear where possible:

- Client direct identifiers.
- Plaintext client contact details.
- Plaintext address snapshots not needed after service completion.
- Free-text notes that may contain sensitive information.
- Lookup hashes when no longer needed for active workflows.

### Deferred implementation

Booking-level anonymization remains deferred until booking retention rules are implemented in code. Phase 1 currently documents the policy and tracks the implementation gap.

## Messages and conversations

### Decision

Messages require special handling because conversations involve multiple participants. Deleting one user should not automatically destroy another user’s legitimate conversation history unless product/legal policy says it should.

### Required behavior

When a participant requests deletion:

- Remove or anonymize the deleted user’s identity from the conversation.
- Preserve conversation records where needed for the other participant’s history, support, safety, disputes, or abuse investigations.
- Delete or redact message body content where required by policy.
- Avoid exposing deleted-user identity through exports after anonymization.

### Recommended Phase 1 policy

For pre-launch Phase 1:

- Preserve conversation structure.
- Anonymize deleted participant identity.
- Defer hard deletion of message body content until conversation ownership and retention requirements are finalized.
- Avoid exporting another participant’s private content as part of one user’s export.

### Deferred implementation

Message deletion is deferred until conversation ownership and retention behavior is finalized.

## Aftercare summaries

### Decision

Aftercare summaries may contain sensitive health, beauty, service, or personal notes. They should be treated as sensitive user content.

### Required behavior

- Export aftercare summaries belonging to the requesting user when traversal is implemented.
- Delete or anonymize summaries tied only to the deleted user where safe.
- Preserve only non-identifying operational references where needed for booking/service history.
- Redact aftercare body/notes from audit payloads.

### Deferred implementation

Aftercare summaries need real Booking/Aftercare traversal before Phase 1 export/delete can claim full coverage.

## Notification deliveries

### Decision

Notification delivery rows should preserve minimal delivery metadata where operationally useful, but should not retain raw contact PII or full message body content longer than necessary.

### Required behavior

Retain only where needed:

- Delivery status.
- Provider event IDs.
- Non-identifying timestamps.
- Failure category or retry metadata.

Delete/anonymize:

- Raw email addresses.
- Raw phone numbers.
- Message bodies.
- Provider payloads containing PII.

### Deferred implementation

Notification deliveries need real relation traversal before Phase 1 export/delete can claim full coverage.

## Attribution events

### Decision

Attribution events may be useful for aggregate analytics, but should not retain direct user identity after deletion unless required for fraud/security.

### Required behavior

- Preserve aggregate/non-identifying analytics.
- Remove or anonymize user/client/pro identity links after deletion where possible.
- Avoid retaining raw contact details, IP addresses, or user agents beyond documented need.

### Deferred implementation

Attribution events need real attribution identity traversal.

## Admin action logs

### Decision

Admin action logs should be retained for auditability, but payloads must be redacted before persistence.

### Required behavior

Admin audit logs may preserve:

- Admin user ID.
- Action name.
- Typed target IDs available in the current schema.
- Redacted target context.
- Redacted old/new/metadata payloads.
- Created timestamp.

Admin audit logs must not persist raw:

- Emails.
- Phone numbers.
- Addresses.
- Notes/free-text sensitive content.
- Tokens.
- Signed URLs.
- Private media paths.
- Payment secrets.
- Raw provider secrets.

### Current implementation notes

lib/admin/auditLog.ts uses redactAuditPayload before storing JSON payloads in AdminActionLog.note.

Dedicated test coverage exists in:

- lib/security/auditRedaction.test.ts
- lib/admin/auditLog.test.ts

### Deferred implementation

AdminActionLog export/delete still needs real schema mapping in the export/delete workflow.

## Media and storage objects

### Decision

Private user-owned storage objects should be deleted when the user requests deletion and when no retention reason exists.

### Required behavior

Delete where supported:

- Private profile media.
- Verification documents.
- Private consultation/aftercare media.
- Private message attachments owned only by the deleted user.

Preserve only where required:

- Dispute evidence.
- Safety/abuse investigation evidence.
- Accounting/payment records.
- Shared records needed by another user’s legitimate history.

### Deferred implementation

Storage object byte deletion requires a storage write boundary. Phase 1 currently tracks this as deferred.

## Export policy

### Decision

A user export should include data that belongs to the requesting user, but should avoid exposing other users’ private data.

### Required behavior

Exports should include:

- User account/profile data.
- Client/professional profile data owned by the requester.
- Saved addresses owned by the requester.
- Booking records involving the requester, with other-party PII minimized.
- Messages authored by or visible to the requester once conversation export policy is implemented.
- Media metadata owned by the requester.
- Privacy/deletion metadata where applicable.

Exports should not include:

- Other users’ private contact details unless required to display a legitimate shared transaction.
- Raw audit payloads.
- Raw provider secrets.
- Private storage object bytes unless explicitly supported and authorized.

### Current implementation notes

lib/privacy/exportUserData.ts provides the Phase 1 export foundation. Some graph traversal remains deferred.

## Delete policy

### Decision

Deletion is a mix of hard deletion, anonymization, and deferred traversal depending on record type.

### Hard-delete when safe

- Temporary action tokens.
- Client saved addresses.
- Booking holds.
- Private media asset rows where storage deletion is supported.
- Convenience records that belong only to the deleted user.

### Anonymize when relational history must remain

- User rows.
- Client/professional profiles.
- Historical booking references.
- Shared conversation references.
- Admin/audit-linked records.

### Defer when ownership or retention is not finalized

- Booking-level anonymization.
- Message deletion.
- Notification delivery traversal.
- Aftercare summary traversal.
- Attribution identity traversal.
- AdminActionLog export/delete mapping.
- Storage byte deletion.
- Tenant-level workflows.

## Phase 1 launch-complete criteria

Phase 1 privacy can be considered launch-complete when:

- Canonical contact normalization is implemented and verified.
- HMAC contact lookup v2 is implemented.
- HMAC v2 backfill has been run/recorded for staging.
- AEAD address encryption is implemented.
- Address encryption backfill has been run/recorded for staging.
- Plaintext contact lookup fallback is removed from reader paths.
- Legacy SHA-256 fallback has a documented pre-launch cleanup plan.
- Admin audit redaction is implemented and tested.
- Export/delete foundation is implemented and tested.
- Booking retention policy is documented.
- Message retention policy is documented.
- PII plaintext-read baseline is either burned down or formally accepted.
- Final proof commands pass from a clean tree.

## Known Phase 1 deferred implementation areas

The following are documented deferrals, not forgotten work:

- Booking-level anonymization implementation.
- Message deletion implementation.
- Notification delivery relation traversal.
- Aftercare summary relation traversal.
- Attribution identity traversal.
- AdminActionLog export/delete schema mapping.
- Storage object byte deletion.
- Tenant-level export/delete workflows.
- Legacy SHA-256 column/index drop after pre-launch QA.

## Final notes

This policy should be updated whenever product behavior changes. If future launch requirements demand stricter deletion, shorter retention, or jurisdiction-specific handling, this document should be revised before implementing code changes.