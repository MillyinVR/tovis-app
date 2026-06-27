# Contact Lookup Hash Threat Model

This document records the contact-lookup-hashing decision for TOVIS and the
migration that resolved it.

It exists because contact lookup hashes are used for client/pro matching and
deduplication. The original launch decision accepted plain SHA-256 as an interim
state; the keyed-HMAC migration described under "Future migration plan" has since
**shipped**, and this doc now reflects the implemented state.

## Current status

```text
Status: RESOLVED — keyed HMAC-SHA256 v2 in production; legacy SHA-256 columns dropped
Original decision date: 2026-05-23 (SHA-256 risk accepted for private beta)
Migration shipped: 2026-05-27 (HMAC v2 added) → 2026-06-01 (legacy columns dropped)
Owner: Tori Morales
Current implementation: HMAC-SHA256 over a normalized contact field, versioned keyring
Residual: security-reviewer sign-off of this threat model; scheduled key rotation
```

## What is implemented today

Contact lookup hashes (`emailHashV2` / `phoneHashV2` on `User` and `ClientProfile`)
are **keyed HMAC-SHA256** blind indexes, not plain digests:

- The hash is computed by `contactLookupHmacHex(...)` in
  `lib/security/crypto/hashLookup.ts` using `createHmac('sha256', key)` over a
  canonicalized contact value (`emailLookupHashV2` / `phoneLookupHashV2`).
- The HMAC key comes from a **versioned keyring** in the `PII_LOOKUP_HMAC_KEYS_JSON`
  env (32-byte base64 keys, keyed by integer version). Each stored hash records its
  `emailHashKeyVersion` / `phoneHashKeyVersion`, so rotation can dual-key without a
  flag day.
- `emailHashV2` / `phoneHashV2` are `@unique` and are the only read path for
  contact matching — there is no plaintext-contact comparison and no raw contact
  value is logged.

This closes the original weakness: without the secret HMAC key, an attacker with a
stolen hash table **cannot** confirm a guessed contact value by recomputing the
digest (the defining problem with plain SHA-256 over the low-entropy email/phone
domain). The threat model is database/operator compromise, and the keyed index
denies offline enumeration of the leaked column.

## How the migration ran (historical record)

The migration followed the standard expand → backfill → contract shape:

1. `20260523000000_add_user_client_contact_lookup_hashes` — interim SHA-256
   `contactHash` columns (the originally-risk-accepted state).
2. `20260527040700_add_contact_lookup_hmac_v2` — added the `*HashV2` +
   `*HashKeyVersion` columns and dual-wrote HMAC v2 alongside the legacy hash
   during a burn-in window; existing rows were backfilled.
3. Readers cut over to the HMAC v2 columns.
4. `20260601000000_drop_legacy_contact_lookup_hashes` — dropped the legacy
   SHA-256 columns once the burn-in was clean.

There are **no** plain-SHA-256 contact-hash columns left in the schema.

## Residual considerations

- **Key rotation.** The HMAC key must be rotated on a schedule and on any
  suspected compromise. The keyring + `*HashKeyVersion` columns already support a
  dual-key window: add a new key version to `PII_LOOKUP_HMAC_KEYS_JSON`, bump
  `CONTACT_LOOKUP_HMAC_KEY_VERSION`, re-hash on write, backfill existing rows to
  the new version, then retire the old key. No schema change is required to rotate.
- **Security-reviewer sign-off.** The remaining open item is a formal security
  review of this threat model; the implementation itself is complete.

## Reference

- Hash implementation: `lib/security/crypto/hashLookup.ts`
  (`contactLookupHmacHex`, `emailLookupHashV2`, `phoneLookupHashV2`).
- Schema columns: `User.emailHashV2` / `phoneHashV2` (+ `*HashKeyVersion`) and the
  same on `ClientProfile` in `prisma/schema.prisma`.
- Drop of legacy columns:
  `prisma/migrations/20260601000000_drop_legacy_contact_lookup_hashes`.
- Production rerun proof: `docs/launch-readiness/test-proof.md` (HMAC v2 + AEAD
  backfills).
- Decision is also surfaced in
  `docs/launch-readiness/sprint-1-verification-checklist.md` row "SHA-256 vs
  HMAC contact hash decision documented".
