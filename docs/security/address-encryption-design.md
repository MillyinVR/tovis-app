# Address Encryption Design

## Status

Draft for implementation.

## Owner

Security / Platform.

## Goal

Protect precise address data and location notes while preserving the product behavior TOVIS needs for booking, mobile-service matching, availability, client settings, support, export/delete, and operational debugging.

This document converts the privacy/data-classification plan into an implementation design for address encryption. It is intentionally specific about fields, read/write paths, authorization, migration, rollback, and launch verification so the implementation does not drift into “privacy vibes with a trench coat.”

## Non-goals

This design does **not** attempt to encrypt every location-like field on day one.

Specifically out of scope for this phase:

- Encrypting public city/state profile display such as `ProfessionalProfile.location`.
- Encrypting professional search index city/state fields used for discovery.
- Encrypting all notification destination snapshots.
- Replacing PostGIS/search logic.
- Encrypting latitude/longitude before deciding the product/search tradeoff.
- Building a full customer-managed key system.
- Dropping raw address columns immediately.

This phase is an expand-first privacy hardening step.

## Principles

1. **Precise address data is sensitive by default.**
   Full street address, apartment/suite, formatted address, place ID, exact lat/lng, mobile service address snapshots, and address notes must be treated as sensitive.

2. **Coarse location can remain queryable.**
   City, state, country, and a limited postal prefix may remain plaintext when needed for search, availability, operational support, and user-facing display.

3. **Encryption happens at the application boundary.**
   Route handlers should not hand-roll encryption logic. They should call a small helper that clearly separates encrypted exact fields from retained coarse fields.

4. **Reads must be authorized before decryption.**
   Do not decrypt first and authorize later. Decryption should happen only after role/ownership checks.

5. **Migrations must be expand-contract.**
   Add nullable encrypted fields first, dual-write, backfill, verify, then later stop reading raw fields and eventually drop or null raw precise fields.

6. **Logging must never include precise address data.**
   Logs may contain coarse city/state/postal prefix when useful, but never full formatted address, address lines, exact coordinates, place IDs, or notes.

7. **Search should not require decryption.**
   Any field needed for filtering/sorting/search should remain in coarse/query-safe form or move to a derived index.

## Data classification

| Data | Classification | Handling |
|---|---|---|
| Full formatted address | Restricted PII | Encrypt |
| Address line 1 | Restricted PII | Encrypt |
| Address line 2 / apartment / suite | Restricted PII | Encrypt |
| Place ID | Sensitive identifier | Encrypt or hash depending use |
| Exact latitude/longitude | Sensitive location | Restrict; consider encryption or precision reduction |
| City | Internal / limited PII | Plaintext allowed |
| State | Internal / limited PII | Plaintext allowed |
| Postal code | Sensitive-ish location | Store limited prefix where possible |
| Country code | Internal | Plaintext allowed |
| Radius miles | Internal preference | Plaintext allowed |
| Address label | Sensitive if user-authored | Encrypt if freeform |
| Mobile service notes | Restricted PII | Encrypt |
| Booking address snapshots | Restricted PII | Encrypt precise snapshot |
| Professional public location display | Public/profile data | Plaintext allowed if user-facing |
| Search index city/state | Query-safe coarse data | Plaintext allowed |
| Notification delivery destination | Restricted PII | Separate encryption plan; not covered here |

## Current schema areas affected

### `ClientAddress`

Current relevant fields:

```prisma
model ClientAddress {
  id        String            @id @default(cuid())
  clientId  String
  kind      ClientAddressKind
  label     String?
  isDefault Boolean           @default(false)

  formattedAddress String?
  addressLine1     String?
  addressLine2     String?
  city             String?
  state            String?
  postalCode       String?
  countryCode      String?
  placeId          String?

  lat Decimal? @db.Decimal(10, 7)
  lng Decimal? @db.Decimal(10, 7)

  radiusMiles Int?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}