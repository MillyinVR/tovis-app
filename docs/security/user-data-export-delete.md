# TOVIS User Data Export and Deletion Policy

This document defines the launch-baseline process for responding to user requests to export, delete, anonymize, or revoke access to personal data in TOVIS.

This is an operational policy for early launch and beta. It is not legal advice. Before broad public launch, this process should be reviewed by a privacy/legal owner and converted into product/admin tooling where needed.

## Goals

- Give users a clear path to request access, export, correction, deletion, or revocation.
- Make manual beta handling safe, consistent, and auditable.
- Prevent accidental deletion of records needed for payment, fraud, safety, dispute, tax, or legal reasons.
- Ensure private media, address data, consultation data, aftercare, and token links are handled deliberately.
- Define what must be automated later.

## Scope

This policy covers:

- Client accounts.
- Professional accounts.
- Admin/support-created records.
- Bookings and booking holds.
- Client addresses and booking address snapshots.
- Consultation notes and approvals.
- Before/after photos and other private media.
- Aftercare summaries and product recommendations.
- Reviews and review media.
- Messages, notifications, and provider delivery metadata.
- Payment provider references and webhook records.
- Verification documents and license-related data.
- Tokens, invites, claim links, aftercare links, and consultation links.
- Logs, audit events, and operational traces.

## Request types

| Request type | Description | Launch handling |
|---|---|---|
| Data export | User asks for a copy of their personal data. | Manual verified support process. |
| Account deletion | User asks to delete their account. | Manual verified support process with retention review. |
| Account anonymization | User asks to remove identifying details while retaining required operational records. | Manual verified support process. |
| Media deletion | User asks to delete private photos or verification documents. | Manual verified support process with booking/dispute/legal checks. |
| Address deletion | User asks to delete saved client address data. | Manual verified support process. |
| Token/link revocation | User asks to revoke an aftercare, claim, consultation, invite, or action link. | Manual verified support process; should be fast. |
| Data correction | User asks to correct profile/contact/address data. | Prefer self-service if available; otherwise manual support. |
| Opt-out | User asks to stop SMS/email/marketing/notifications. | Respect transactional/legal requirements; update notification preferences. |

## Identity verification

Before processing any request, verify the requester.

### For logged-in users

Accept a request from the authenticated account if:

- The request is made from the logged-in account.
- The email/phone on the account is verified.
- The request affects only that user’s own data.

### For email/support requests

Require at least one of:

- User replies from the verified account email.
- User confirms a verification link sent to their account email.
- User confirms a verification code sent to their account phone.
- For Pro accounts, additional verification may be required for business/payment/license records.

### For sensitive requests

Require stronger verification for:

- Account deletion.
- Media deletion.
- Verification document deletion.
- Payment settings deletion.
- Professional profile deletion.
- Legal/dispute-related records.

Do not process sensitive deletion requests from an unverified email, support chat, social message, or untrusted third party.

## Response timeline

Launch baseline targets:

| Request | Target first response | Target completion |
|---|---:|---:|
| Link/token revocation | 1 business day | 1 business day |
| Address deletion | 3 business days | 7 business days |
| Private media deletion | 3 business days | 14 business days |
| Data export | 5 business days | 30 days |
| Account deletion/anonymization | 5 business days | 30 days |
| Complex/legal/dispute records | 5 business days | Case-by-case |

If a request cannot be completed within the target window, send the user a status update explaining the delay and expected next step.

## Request intake

Create a support ticket for every export/deletion/revocation request.

Minimum ticket fields:

```text
requestId
requestType
requesterUserId
requesterRole
verifiedIdentity: true/false
verificationMethod
requestedAt
status
assignedOwner
affectedResources
retentionExceptions
completedAt
notes