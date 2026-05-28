cat > docs/privacy/phase-1-privacy-proof.md <<'EOF'
# Phase 1 Privacy / PII Contract Proof

## Status

Phase 1 removes the hard public-launch privacy blocker by establishing canonical contact normalization, audit redaction, AEAD address encryption, HMAC contact lookup v2, and user export/delete foundations.

## Verification date

2026-05-27

## Completed scope

### 1.1 Canonical contact normalizer

Implemented canonical contact normalization in:

- `lib/security/contactNormalization.ts`
- `tools/check-canonical-normalization.mjs`

Verification:

```bash
node tools/check-canonical-normalization.mjs