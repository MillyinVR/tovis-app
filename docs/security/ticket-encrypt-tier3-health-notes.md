# Ticket — Encrypt Tier-3 health-adjacent notes (allergy + consultation)

**Type:** privacy / PII (WS-3 Tier-3, scoped subset) · **Effort:** M · **Risk:** medium (dual-write +
backfill on live-ish data) · **Decision:** finish-plan #3 (resolved 2026-06-13) — encrypt the two
highest-sensitivity free-text fields now; date-stamped risk-accept messages/bio.

## Why (and why only these fields)

Free-text on a beauty platform that is **health-adjacent** is the highest-sensitivity, most
breach-damaging, most regulator-relevant PII (GDPR special categories; US state privacy law). Encrypting
now — while data volume is tiny — is cheap and reuses a proven pattern; doing it post-100k is a painful
backfill. These two are also displayed **in-context** (a pro viewing their own client / a booking's
consultation), **not searched**, so encryption has no query implications. Message bodies + bio are a
bigger lift (searched/rendered broadly) and stay risk-accepted with a written review date — out of scope here.

## In scope (verified field names at HEAD)

| Model | Field(s) | Notes |
|---|---|---|
| `ClientAllergy` | `description String?` (primary), `label String` | The allergy detail. `label` may be a short tag ("Latex") but is still health data — encrypt both. |
| `BookingConsultation` | `notes String?`, `clientMessage String?` | Canonical consultation notes + the client's free-text message. |
| `BookingCloseoutAuditLog` | `consultationNotes`, `clientNotes`, `internalNotes` (~`prisma/schema.prisma:2075-2099`) | **Critical:** these are plaintext *snapshots* of the above into an audit record. Encrypting the source while leaving these plaintext defeats the purpose — they must be encrypted (or stop snapshotting the raw text). Implementer: confirm exact model + columns via grep before migrating. |

> First implementer step: `grep -rn "\.description\|\.notes\|clientMessage\|consultationNotes\|internalNotes\|clientNotes" lib app | grep -iE "allergy|consultation|closeout"` to enumerate every write **and read** site.

## Approach — reuse the address-encryption playbook (expand → contract)

Mirror `lib/security/addressEncryption.ts` + `lib/security/crypto/aead.ts` (`encryptAead`/`decryptAead`,
`ADDRESS_AEAD_ALGORITHM = 'aes-256-gcm-v1'`, versioned envelope). Do **not** invent a new crypto path.

1. **NEW `lib/security/notesEncryption.ts`** — `buildNotesEnvelope(plaintext): NotesEnvelopeV1`
   (`{ algorithm: 'aes-256-gcm-v1', keyVersion, ciphertext, iv, authTag }` via `encryptAead`) and
   `readNotesEnvelope(envelope): string`. Same key source/keyring as address encryption; `keyVersion`
   from day one for rotation. Plus a typed `buildNotesPrivacyWriteData()` returning the dual-write fields,
   mirroring `buildAddressPrivacyWriteData`.
2. **Migration A (expand):** add nullable envelope columns alongside plaintext —
   `ClientAllergy.descriptionEncrypted`/`labelEncrypted`, `BookingConsultation.notesEncrypted`/
   `clientMessageEncrypted`, and the closeout-audit snapshot encrypted variants. JSONB envelope columns
   (matches `encryptedAddressJson`). Leave plaintext untouched.
3. **Dual-write:** route every write site (allergy create/update, consultation save, closeout snapshot)
   through `buildNotesPrivacyWriteData()` so plaintext + envelope are written together.
4. **Backfill** `prisma/scripts/backfillNotesEncryption.ts` — batched (1000/tx), idempotent
   (`WHERE "*Encrypted" IS NULL`), sample-verify by decrypting N rows, logs count + duration. (Pattern:
   `prisma/scripts/backfillAddressEncryption.ts`.)
5. **Reader cutover:** display sites (pro client detail, consultation view, closeout review) read via
   `readNotesEnvelope`, with a one-burn-in plaintext fallback, then envelope-only.
6. **Migration C (contract):** after ≥1 week stable dual-write, drop the plaintext columns; writers stop
   setting plaintext.
7. **Guard:** extend `tools/check-pii-plaintext-reads.mjs` to flag direct reads of the decommissioned
   plaintext columns outside `lib/security/`. Keep the baseline at zero for the new fields.

## Acceptance criteria

- `lib/security/notesEncryption.ts` exists with roundtrip + keyVersion tests (pattern: address tests).
- `SELECT "descriptionEncrypted" FROM "ClientAllergy" LIMIT 1` returns an AEAD envelope, not plaintext;
  same for `BookingConsultation.notesEncrypted`/`clientMessageEncrypted` and the closeout snapshots.
- No production read of the plaintext columns outside `lib/security/` (guard exits 0; new fields not baselined).
- Display surfaces still render allergy/consultation text correctly (decrypt-on-read); logs never contain raw note text (confirm redaction).
- Backfill is idempotent (re-run is a no-op) and sample-decrypt verifies plaintext match.
- `docs/security/data-classification.md` updated: these fields move from "Tier-3 plaintext (risk-accepted)"
  to "Tier-3 encrypted"; messages/bio explicitly risk-accepted **with a dated review**.

## Risks & mitigations
- **Audit-snapshot leak** (the closeout-log copies) → enumerate + encrypt them in the same migration; this is the easy-to-miss part.
- **Backfill on volume** → batched + idempotent + resumable; pre-launch volume keeps it to minutes.
- **Key compromise / rotation** → `keyVersion` column from day one; rotation = re-encrypt backfill (documented), same as address.
- **Display regressions** → reader cutover behind a one-burn-in plaintext fallback before the contract migration.

## Out of scope (risk-accepted with a dated review — record in data-classification.md)
- `Message` bodies, `ProfessionalProfile.bio`, generic `internalNotes`/`adminNotes` on non-consultation models, support-ticket text. Bigger lift (searched/rendered broadly); revisit before public-ramp stages.
