# Encrypt email at rest — rollout

Mirrors the shipped phone-at-rest work. Email already has a separate blind-index
lookup hash (`emailHashV2` / `emailHashKeyVersion`); this only adds an
AEAD-encrypted copy of the *displayable* value so a DB/backup/export leak no
longer exposes raw addresses. The plaintext `email` column stays the source of
truth and the unique constraint during burn-in.

## Phase 1 — EXPAND (this PR) ✅

- Schema: `User.emailEncrypted Json?` + `ClientProfile.emailEncrypted Json?`
  (migration `20260627030000_add_email_encrypted`, additive, no backfill).
- Crypto boundary: `lib/security/emailEncryption.ts` (`EMAIL_KEY_VERSION =
  'email-aead-v1'`, AD `tovis:email-privacy:v1`).
- Prisma boundary: `lib/security/emailPrivacy.ts` —
  `buildEmailEncryptionWriteData({ email })` (**fail-soft**: a missing keyring
  must never break signup; plaintext is retained and the backfill recovers the
  envelope) + `readEncryptedEmailOrFallback(encrypted, plaintext)` for later.
- Dual-write wired beside every `build*ContactLookupData({ email, … })` site:
  `auth/register` (User + ClientProfile), `workspace/switch`, `upsertProClient`
  (create + matched-update).

Reads still use the plaintext column this phase — nothing user-facing changes.

## Operator steps (do these to actually start encrypting)

1. **Add an `email-aead-v1` key** to `PII_AEAD_KEYS_JSON` in Vercel (Sensitive),
   alongside the existing address/notes/phone keys. Until this is set, writes are
   fail-soft (envelope null, plaintext retained) — safe, just not yet encrypting.
2. **Backfill** existing rows once the key is live:
   ```
   pnpm backfill:email-encryption -- --dry-run     # report
   pnpm backfill:email-encryption -- --write        # apply (idempotent; re-runnable)
   ```
   A row is eligible only when it has a non-blank email but no valid envelope, so
   the script is safe to re-run.

## Phase 2 — READ-SWAP (follow-up PR)

Point display/send paths at `readEncryptedEmailOrFallback` (envelope preferred,
plaintext fallback for any not-yet-backfilled row). Until then plaintext remains
the read source, so this phase has no urgency.

## Phase 3 — CONTRACT (follow-up PR, careful)

Drop the plaintext `User.email` / `ClientProfile.email` columns and make the
read boundary fail-hard. PREREQUISITE: `User.email` is the `@unique` login
constraint, so first confirm every lookup rides `emailHashV2` (already `@unique`)
and move/replace the uniqueness guarantee before dropping the column.
