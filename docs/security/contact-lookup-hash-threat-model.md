# Contact Lookup Hash Threat Model

This document records the launch decision for contact lookup hashing in TOVIS.

It exists because contact lookup hashes are currently used for client/pro matching and deduplication, and the current implementation uses plain SHA-256 rather than HMAC-SHA256.

## Current status

```text
Status: Risk accepted for private beta / early controlled launch
Decision date: 2026-05-23
Owner: Tori Morales
Current implementation: SHA-256 contact lookup hash
Target future implementation: HMAC-SHA256 before raw contact-field contraction
```

## Why SHA-256 today

TOVIS currently stores `contactHash` columns derived with plain SHA-256 over a
normalized contact field (email or phone). The hash is used for:

- Deduplicating client/pro contact matching during invite/claim flows.
- Internal lookup so we never need to log or compare a raw contact value.

Plain SHA-256 over a low-entropy, well-known domain (email addresses, phone
numbers) is **not** a privacy-preserving transform on its own — an attacker
with a stolen `contactHash` value can confirm a guess for a specific contact
by recomputing the digest. Risk is bounded by the fact that contact hashes
are not exposed in public APIs, are not used as authentication credentials,
and are scoped to internal matching.

For private beta and early controlled launch, this risk is **accepted**:

- Public surface area is small.
- The threat model is "operator/database compromise," not "public hash
  enumeration."
- HMAC migration requires a key management plan (rotation, KMS-backed
  secret, dual-write window) that we explicitly do not want to rush.

## Future migration plan

Before public launch or any expansion that increases the value of a leaked
hash table, migrate to HMAC-SHA256 with a dedicated secret key.

Migration shape (not in this ticket):

1. Add a versioned HMAC key (KMS-backed) and a `contactHashKeyVersion`
   column wherever `contactHash` is stored.
2. Dual-write SHA-256 + HMAC-SHA256 hashes during a contraction window.
3. Backfill HMAC values for existing rows.
4. Cut over readers to HMAC; keep the legacy column for one burn-in window.
5. Drop the legacy column in a follow-up migration once the burn-in is clean.

The HMAC key must be rotated on a schedule and on any suspected compromise.
Rotation requires re-hashing with the new key and updating the version
column; the dual-write/backfill/cutover pattern repeats per rotation.

## Reference

- Hash implementation: `lib/security/crypto/hashLookup.ts`.
- Decision is also surfaced in
  `docs/launch-readiness/sprint-1-verification-checklist.md` row "SHA-256 vs
  HMAC contact hash decision documented".
