# TOVIS Data Classification

This document classifies the main data types handled by TOVIS so engineering, support, and operations can make consistent decisions about access, retention, deletion, export, logging, encryption, and incident response.

This is a launch-readiness baseline. Review it before public launch and whenever new models, routes, vendors, or media types are added.

## Goals

- Identify sensitive data before launch.
- Define who may access each data class.
- Define default retention and deletion expectations.
- Prevent sensitive data from leaking into logs, URLs, analytics, support tools, or public responses.
- Create a shared reference for future privacy, security, support, and compliance work.

## Classification levels

| Level | Name | Definition | Examples |
|---|---|---|---|
| L0 | Public | Safe to expose publicly by product design. | Public profile display name, public portfolio images, public service names. |
| L1 | Internal | Operational data that is not sensitive by itself, but should not be public. | Feature flags, internal IDs, non-sensitive route metrics. |
| L2 | Personal | Personally identifiable user data. Exposure would be a privacy incident. | Email, phone, name, handle, account identifiers. |
| L3 | Sensitive personal | Personal data tied to location, services, beauty/health context, payments, or identity verification. Exposure would be high impact. | Client addresses, booking address snapshots, license/verification data, consultation notes. |
| L4 | Sensitive media / restricted | Private user media, credentials, secrets, tokens, or security-critical data. Exposure could cause serious privacy, financial, or security harm. | Before/after photos, verification documents, auth tokens, API keys, webhook secrets. |

## Default handling rules

| Requirement | L0 | L1 | L2 | L3 | L4 |
|---|---:|---:|---:|---:|---:|
| May appear in public UI | Yes | No | No, unless explicitly intended | No | No, except intentionally public media |
| May appear in server logs | Yes | Minimal | No raw values | No raw values | Never |
| May appear in URLs | Yes | Avoid | No | No | Never |
| May be sent to analytics | Yes | Aggregated only | No raw values | No | No |
| Requires access control | Normal | Internal | User/role scoped | Strict user/role scoped | Strict user/role scoped + short-lived access |
| Requires audit trail for admin/support access | No | Recommended | Yes | Yes | Yes |
| Requires deletion/export plan | No | Case-by-case | Yes | Yes | Yes |
| Encryption at rest | Platform default | Platform default | Platform default; column strategy planned | Column/envelope strategy planned | Strongly preferred; secrets via secret manager |

## Core data inventory

| Data type | Classification | Primary storage | Access rules | Retention expectation | Launch notes |
|---|---:|---|---|---|---|
| User ID / internal model IDs | L1 | Postgres | Internal app use only. Do not expose unnecessarily. | Keep while account exists; may remain in audit logs. | IDs are not secrets, but avoid leaking cross-user resource IDs in public payloads. |
| First name / last name | L2 | `User`, profile models | User, relevant booking counterpart, authorized admin/support. | Keep while account exists unless deletion/anonymization requested. | Use display names in UI; avoid logging raw full names. |
| Email address | L2 | `User`, notification snapshots | User, auth flows, notification provider, authorized admin/support. | Keep while account exists; delete/anonymize under account deletion policy unless legally retained. | Do not log raw email. Consider lookup hash + encrypted value in a future phase. |
| Phone number | L2 | `User`, SMS verification/notification data | User, auth/verification, notification provider, authorized admin/support. | Keep while account exists; delete/anonymize under account deletion policy unless legally retained. | Do not log raw phone. Keep SMS abuse/rate-limit keys non-reversible where possible. |
| Password hash | L4 | `User` | Auth system only. No admin/support access. | Keep while account exists; delete on account deletion. | Never log. Store password hashes only; never store raw passwords. |
| Auth/session tokens | L4 | Cookies, token tables where applicable | Auth system only. | Short TTL; revoked on logout/password/security events. | HttpOnly cookies only. Never log tokens or include them in analytics. |
| Verification tokens / action tokens | L4 | Token tables, hashed where supported | Token verifier only. | Short TTL; revoke or expire after use. | Store hashes, not raw tokens. Raw tokens should only exist at creation/display time. |
| Client profile | L2 | `ClientProfile` | Client, authorized app flows, assigned Pro where booking relationship allows, admin/support. | Keep while account exists. | Do not expose to unrelated Pros. |
| Professional profile | L2/L3 | `ProfessionalProfile` | Pro, public profile fields to clients/public, admin/support. | Keep while account exists. | Separate public profile fields from private verification/business fields. |
| Public Pro profile content | L0/L2 depending field | `ProfessionalProfile`, related public media | Public only for fields intentionally displayed. | Keep while Pro account/profile is active. | Business name/handle/bio may be public; legal name/license fields are not automatically public. |
| Professional license / verification data | L3/L4 | `ProfessionalProfile`, verification document models/storage | Pro, verification/admin reviewers, automated verification jobs. | Keep according to verification/legal retention policy. | Treat documents/images as L4. Avoid raw values in logs. |
| Client addresses | L3 | `ClientAddress` | Client, assigned Pro only when needed for mobile/service booking, admin/support. | Keep while account exists or until user deletes address; booking snapshots may have separate retention. | Do not expose full address before booking requires it. |
| Booking address snapshots | L3 | `Booking` snapshot fields/JSON | Client, assigned Pro, admin/support. | Retain with booking record unless deletion/anonymization policy says otherwise. | Required for service history/disputes; define anonymization behavior. |
| Booking metadata | L2/L3 | `Booking`, `BookingHold`, service item tables | Client, assigned Pro, admin/support. | Keep for operational/account history; define post-retention anonymization. | Booking time/service is personal context; do not expose to unrelated users. |
| Service catalog | L0/L1 | `ServiceCategory`, `Service`, offerings | Public/admin/pro depending field. | Keep while catalog item exists. | Public service names/prices are generally L0; internal catalog flags are L1. |
| Professional offerings/pricing | L0/L1 | `ProfessionalServiceOffering`, add-ons | Public/client-visible when active; Pro/admin editable. | Keep while active; retain history if needed for bookings. | Snapshot pricing onto bookings for auditability. |
| Availability / working hours | L1/L2 | `ProfessionalLocation`, schedule config, calendar blocks | Pro, clients searching availability, admin/support. | Keep while schedule exists; old versions may be retained for audit/debugging. | Public availability is less sensitive but still tied to a person/business. |
| Calendar blocks | L2/L3 | `CalendarBlock` | Pro, scheduling system, admin/support. | Keep while relevant; delete/anonymize after retention window. | Block titles/notes may reveal private details; avoid exposing titles to clients. |
| Consultation notes | L3 | `ConsultationApproval`, booking/session notes | Client, assigned Pro, admin/support where needed. | Retain with booking/aftercare unless deletion/anonymization policy says otherwise. | Sensitive beauty/health-adjacent context. Never log raw notes. |
| Consultation approval proof | L3/L4 | `ConsultationApprovalProof`, action-token records | Client, assigned Pro, admin/support. | Retain for dispute/audit window; define duration. | Includes destination snapshots, action proof, method, timestamps. Treat as sensitive evidence. |
| Before photos | L4 | Supabase Storage + `MediaAsset` | Client, assigned Pro, authorized admin/support. | Retain per media retention policy; delete on approved media deletion request unless legal/dispute hold applies. | Private by default. Short-lived signed URL access only. |
| After photos | L4 | Supabase Storage + `MediaAsset` | Client, assigned Pro, authorized admin/support. | Retain per media retention policy; delete on approved media deletion request unless legal/dispute hold applies. | Private by default unless explicitly published/consented. |
| Public portfolio / review media | L0/L4 before publish | Supabase Storage + `MediaAsset` / review media | Public only after explicit publish/visibility state; owner/admin can manage. | Retain while published or until removed. | Require clear transition from private to public; audit publish/unpublish. |
| Verification documents | L4 | Supabase Storage + verification document metadata | Pro, authorized verification/admin reviewers only. | Retain according to verification/legal policy. | Never public. Signed URL only. Strong audit requirement. |
| Aftercare summaries | L3 | `AftercareSummary`, product recommendation tables | Client, assigned Pro, admin/support. | Retain with booking unless deletion/anonymization policy says otherwise. | May include sensitive instructions/notes. Use hashed action tokens for shared access. |
| Product recommendations | L1/L2/L3 depending context | Aftercare/product recommendation tables | Client, assigned Pro, admin/support. | Retain with aftercare summary. | Product name alone may be low sensitivity; recommendation tied to client/service is sensitive. |
| Reviews and ratings | L0/L2/L3 depending visibility | `Review`, media tables | Public if published; client/pro/admin otherwise. | Retain while published or until removed. | Separate public review text from private moderation/admin metadata. |
| Messages / chat | L3 | Message tables | Sender, recipient, admin/support under policy. | Define retention window; delete/export under user request policy. | Do not log message bodies. |
| Notification dispatch/delivery records | L2/L3 | Notification/dispatch/delivery/event tables | System, recipient, admin/support. | Retain for troubleshooting/compliance window, then delete/anonymize. | May include recipient snapshots and provider metadata. Avoid storing full message bodies unless required. |
| SMS/email provider metadata | L2/L3 | Provider webhook/event tables | System/admin/support. | Retain for delivery troubleshooting and compliance window. | Provider IDs can link to user contact history. |
| Stripe customer/account/session/payment IDs | L2/L3 | Booking/payment settings/webhook event tables | System, relevant user, admin/support. | Retain for financial/legal requirements. | Store provider IDs, not card data. Never store raw card numbers/CVC. |
| Payment settings | L3 | `ProfessionalPaymentSettings`, Stripe Connect data | Pro, payment system, admin/support. | Retain while payment account exists and as legally required. | Treat payout/payment configuration as sensitive. Audit changes. |
| Stripe webhook payloads | L3/L4 depending contents | Webhook event log | Payment system/admin/support. | Retain for replay/audit window. | Avoid logging full payloads if they include personal/payment details. |
| Admin action logs | L2/L3/L4 depending target | `AdminActionLog`, audit tables | Admin/security/ops. | Retain for audit period. | Should include actor/action/resource/request metadata, not unnecessary raw sensitive values. |
| Booking closeout audit logs | L2/L3/L4 depending event | `BookingCloseoutAuditLog` | Assigned Pro/client where appropriate, admin/support. | Retain with booking/audit policy. | Useful for disputes; avoid raw notes/media URLs unless necessary. |
| Rate-limit keys | L1/L2 | Redis / rate-limit store | System only. | Short TTL. | Use hashed/normalized keys for phone/email/IP where possible. |
| Search index rows | L0/L1/L2 depending field | Search/index tables/cache | Public search/client discovery/admin. | Refresh/delete with source records. | Do not index private verification, address, notes, or private media fields. |
| Runtime flags | L1 | Runtime flag store/admin config | Admin/ops only. | Keep change history if possible. | Flag changes should be audited before launch. |
| Logs and traces | L1-L4 depending content | Vercel/Sentry/log provider | Engineering/ops/security only. | Retain per vendor/security policy. | Sanitization required. Logs must not contain tokens, raw PII, private media URLs, or notes. |
| Secrets and API keys | L4 | Environment/secret manager | System/authorized ops only. | Rotate on schedule and incident. | Never commit. Never log. Use a secret manager where possible. |

## Access principles

- Users may access their own account/profile data.
- Clients may access bookings, consultation decisions, media, and aftercare tied to their own bookings.
- Pros may access bookings, consultation decisions, media, and aftercare tied to their own professional profile.
- Admin/support access must be purpose-limited and audited.
- Public access must be limited to fields explicitly designed for public display.
- Token-based access must use hashed tokens at rest, expiration, revocation, and single-use semantics where appropriate.
- Private media must be served through short-lived signed URLs only after app-level authorization checks.

## Logging and analytics rules

Do not log or send to analytics:

- Raw auth/session/action tokens.
- Raw password values or password hashes.
- Full email addresses or phone numbers.
- Client addresses or booking address snapshots.
- Consultation notes, aftercare notes, internal notes, or message bodies.
- Private media URLs, signed URLs, storage paths when avoidable, or verification document URLs.
- Stripe webhook payloads unless redacted.
- Provider secrets, API keys, webhook secrets, or service-role keys.

Prefer logging:

- Request ID.
- User ID or actor ID only when needed.
- Booking ID only when needed.
- Route name.
- Error code.
- Status code.
- Duration.
- Safe enum states.
- Hashed identifiers for lookup/debugging when raw values are not required.

## Retention baseline

These are launch baseline defaults, not final legal advice.

| Data class | Baseline retention |
|---|---|
| Auth/session tokens | Expire by TTL; revoke on logout/security events. |
| Verification/action tokens | Expire by TTL; revoke after use or explicit revocation. |
| Rate-limit keys | TTL only; no long-term retention. |
| Logs/traces | Short operational retention; redact sensitive values. |
| Notification delivery events | Retain for troubleshooting/compliance window, then purge/anonymize. |
| Booking records | Retain for user history, disputes, tax/payment support, and operational needs; define deletion/anonymization behavior. |
| Private booking media | Retain per user/media policy; support deletion request workflow unless legal/dispute hold applies. |
| Verification documents | Retain only as long as needed for verification/legal obligations. |
| Payment/webhook records | Retain according to financial/legal/provider requirements. |
| Audit logs | Retain for security/audit window; avoid storing unnecessary raw sensitive values. |

## Deletion and export expectations

Before public launch, TOVIS needs a documented process for:

- Account data export.
- Account deletion or anonymization.
- Client address deletion.
- Private media deletion.
- Verification document deletion or retention exception.
- Aftercare link revocation.
- Token revocation.
- Admin/support access review.

Manual processing is acceptable for early beta if documented, tracked, and auditable.

## Encryption roadmap

Current baseline may rely on provider/database encryption at rest. That is not enough as a long-term privacy posture for all sensitive fields.

Recommended phased roadmap:

1. Add normalized hashes for lookup-sensitive fields where needed, such as email/phone/token lookups.
2. Add encrypted columns or envelope encryption for high-risk address and sensitive snapshot fields.
3. Add encrypted storage for sensitive free-text fields, such as consultation notes, internal notes, and aftercare notes, where product requirements allow.
4. Define key management and rotation using a real secret manager/KMS.
5. Document operational tradeoffs for search, support, analytics, and migrations before encrypting columns.

## Launch gaps

The following items should be completed or explicitly accepted before public launch:

- [ ] Finalize data retention windows by data class.
- [x] Create `docs/security/user-data-export-delete.md`.
- [x] Create private media incident runbook.
- [x] Create PII encryption roadmap.
- [ ] Assign PII encryption roadmap owners.
- [ ] Add admin/support access audit policy.
- [ ] Verify logs do not contain raw PII, tokens, signed URLs, notes, or secrets. Auth observability has a sanitizer and tests; all log surfaces still need review.
- [ ] Verify analytics events do not include raw PII or sensitive booking/media details.
- [ ] Verify public profile/search indexing excludes private fields.
- [x] Verify primary token-based flows store hashes, not raw tokens, for new records.
- [x] Verify private media access uses signed URLs and storage policy-as-code in repo proof.

## Review checklist for new data fields

Before adding a new model column, API payload field, log field, analytics property, cache key, or vendor integration, answer:

1. What classification level is this data?
2. Who needs access?
3. Is it exposed in public UI, API responses, logs, analytics, cache, or URLs?
4. What is the retention rule?
5. How is it exported or deleted?
6. Does it require audit logging?
7. Does it require encryption, hashing, or tokenization?
8. Could this field reveal private service, health, location, payment, or identity context?
9. What happens if this field leaks?
10. Which tests or checks prove the intended access behavior?

## Ownership

| Area | Primary owner | Notes |
|---|---|---|
| Product data classification | Product + Engineering | Keep this doc updated when product scope changes. |
| Security controls | Engineering | Access control, encryption, token handling, storage policies, logging rules. |
| Support workflows | Support/Ops + Engineering | Export/delete requests, incident triage, user communication. |
| Legal/compliance review | Legal/Privacy owner | Required before broad public launch. |
| Incident response | Engineering/Ops | Runbooks, provider rotation, audit review, mitigation. |

## Change control

Update this document when:

- A new model stores user, booking, payment, message, media, verification, or notification data.
- A new third-party provider receives user data.
- A field becomes public or changes visibility.
- A token/link flow is added.
- A retention/deletion/export policy changes.
- A new logging/analytics event is added.
- A security incident or near miss reveals a classification gap.
