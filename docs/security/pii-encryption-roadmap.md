# TOVIS PII Encryption Roadmap

This document defines the phased roadmap for protecting sensitive personal data in TOVIS using hashing, encryption, access controls, logging rules, and migration-safe rollout patterns.

This is a launch-readiness planning document. It is not legal advice and should be reviewed by the engineering owner, privacy/legal owner, and whoever gets stuck being “security person” for the week. Congratulations to that lucky soul.

## Goals

- Reduce blast radius if the database, logs, exports, backups, or support tools expose sensitive fields.
- Avoid storing raw sensitive values when a hash is enough.
- Encrypt high-risk personal and service-context data where product behavior allows.
- Keep booking, search, support, and notification flows working during migration.
- Avoid chaotic “encrypt everything immediately” changes that break the app right before launch.

## Non-goals for the first launch phase

The first phase should **not** try to encrypt every field in the database.

Do not start with:

- Full-database application-level encryption.
- Encrypting every searchable field.
- Encrypting every enum/status/timestamp.
- Encrypting every internal ID.
- Encrypting service catalog or public profile data.
- Building a huge custom crypto framework from scratch.
- Migrating all historical records in one giant risky deployment.

The first phase should prioritize the highest-risk fields and the cleanest migration path.

## Data protection terms

| Term | Meaning | Example |
|---|---|---|
| Hashing | One-way transformation used for lookup or comparison. Cannot be decrypted. | Token hash, email lookup hash. |
| Encryption | Reversible protection using a key. Data can be decrypted by authorized server code. | Encrypted address line, encrypted notes. |
| Tokenization | Replacing sensitive value with a random reference. | Provider payment IDs instead of card data. |
| Redaction | Removing or masking sensitive values from logs/payloads. | `t***@example.com`, `***1234`. |
| Envelope encryption | Encrypting data with a data key, then encrypting that data key with a master key/KMS. | Long-term scalable encryption strategy. |
| Deterministic encryption | Same plaintext produces same ciphertext. Useful for lookup, but leaks equality patterns. | Usually avoid unless strongly justified. |
| Lookup hash | Normalized hash stored beside encrypted data so the app can search without decrypting many rows. | `emailHash`, `phoneHash`. |

## Recommended crypto rules

- Use well-reviewed platform/library primitives only.
- Do not invent encryption algorithms.
- Do not reuse auth/session secrets as encryption keys.
- Keep encryption keys out of Git.
- Keep encryption keys out of logs.
- Rotate keys through a documented process.
- Use authenticated encryption, such as AES-GCM or a vetted KMS/envelope encryption primitive.
- Prefer random IV/nonce per encrypted value.
- Store encryption metadata needed for migration, such as key version and algorithm.
- Store hashes only when lookup/comparison is required.
- Add tests proving raw sensitive values are not returned in API responses, logs, or exports unintentionally.

## Classification-driven approach

Use `docs/security/data-classification.md` as the source of truth.

| Classification | Default protection |
|---|---|
| L0 Public | No encryption beyond platform defaults. |
| L1 Internal | Access control + platform encryption at rest. |
| L2 Personal | Access control + redaction + optional lookup hash/encryption depending field. |
| L3 Sensitive personal | Strong access control + redaction + encryption roadmap. |
| L4 Sensitive media / restricted | Strong access control + signed URL boundaries + token hashing + encryption/key-management review. |

## Field priority matrix

| Priority | Field/data | Protection goal | Proposed approach | Launch phase |
|---|---|---|---|---|
| P0 | Raw action/invite/reset/verification tokens | Never store raw reusable secrets. | Store hash only; raw token exists only at creation/display time. | Already underway / must verify |
| P0 | Client/pro invite tokens | Prevent database leak from becoming account-claim leak. | `tokenHash`; legacy raw token nullable/deprecated; remove later. | Already underway / contract later |
| P0 | Signed media URLs | Prevent long-lived private media exposure. | Short TTL; never persist signed URLs; redact from logs. | Launch |
| P0 | API keys/webhook secrets/service-role keys | Prevent full-system compromise. | Secret manager/env only; rotate on incident. | Launch |
| P0 | Passwords | Never store raw passwords. | Password hash only. | Existing baseline |
| P1 | Email | Reduce identity exposure and support secure lookup. | Add normalized `emailHash`; later encrypt raw email or isolate contact table. | Early post-baseline |
| P1 | Phone | Reduce identity exposure and SMS abuse risk. | Add normalized `phoneHash`; later encrypt raw phone or isolate contact table. | Early post-baseline |
| P1 | Client saved addresses | Protect high-risk location data. | Encrypted address fields + optional coarse city/state/zip fields for filtering. | Before broad launch if feasible |
| P1 | Booking address snapshots | Protect historical mobile-service location context. | Encrypted snapshot fields + minimized display fields. | Before broad launch if feasible |
| P1 | Verification documents | Prevent document exposure. | Private storage, signed URLs, strict RLS, audit, retention limit; consider object-level encryption later. | Launch + post-launch |
| P1 | Before/after photos | Prevent private media exposure. | Private bucket, signed URLs, strict RLS, short TTL, audit, deletion workflow. | Launch |
| P2 | Consultation notes | Protect beauty/health-adjacent service context. | Encrypted notes field; sanitized preview if needed. | Post-launch |
| P2 | Aftercare notes | Protect private service instructions. | Encrypted notes/body fields; sanitized display cache only if needed. | Post-launch |
| P2 | Message bodies | Protect private conversations. | Encrypted body field; search limitations documented. | Post-launch |
| P2 | Notification destination snapshots | Reduce contact leakage. | Redact or encrypt destination snapshots; keep provider IDs. | Post-launch |
| P2 | Admin/support notes | Protect internal sensitive context. | Encrypt or restrict; avoid raw PII. | Post-launch |
| P3 | Public profile fields | Do not encrypt public data. | Access control and explicit visibility only. | Not needed |
| P3 | Service catalog | Do not encrypt. | Public/internal access rules. | Not needed |
| P3 | Status enums/timestamps | Do not encrypt. | Access control only. | Not needed |

## Phase 0 — Verify existing token hashing

### Goal

Confirm that all high-risk link/token flows store hashes instead of raw reusable tokens for new records.

### Flows to verify

- Password reset tokens.
- Email verification tokens.
- Phone verification codes, or equivalent verifier.
- Client action tokens.
- Consultation action links.
- Aftercare access links.
- Rebook links.
- Pro/client claim invite links.
- NFC/claim links if they grant privileged access.

### Acceptance criteria

- New token rows store a hash, not the raw token.
- Raw token is only returned once at creation time.
- Lookup hashes normalized token input before hashing.
- Expired/revoked/used tokens fail safely.
- Legacy raw-token fallback is documented and temporary.
- Tests prove the primary lookup path uses the hash.
- Logs and support tickets do not contain raw tokens.

### Suggested structural check

Add or maintain a check that fails active code usage of unsafe token fields except in explicit legacy/migration contexts.

Example allowlist:

```text
prisma/migrations/**
docs/**
*.test.ts
legacy fallback modules with deprecation comments