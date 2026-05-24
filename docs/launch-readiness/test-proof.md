# TOVIS Launch Readiness Test Proof

This file records concrete test/proof runs for launch-readiness work.

Do not mark a launch-readiness item fully proven unless the relevant command, environment, commit SHA, result, and known limitations are recorded here.

---

## Proof run — booking/session safe logging hardening

- Checklist item: Replace raw error logging in booking/session hot routes and sibling booking routes.
- Owner: Tori Morales
- Date: 2026-05-23
- Related commit: `8f2a424` — `Harden booking route error logging`
- Status: Passed locally
- Environment:
  - Local: yes
  - CI: not yet recorded
  - Staging: not yet recorded
  - Production: not yet recorded

### Test summary

This run verifies that the booking/session route logging hardening removed raw `console.error(..., error)` logging patterns from the scoped booking API routes and that the updated route tests still pass.

The focused proof covered Pro booking creation, Pro booking read/update, cancel, final review, consultation services, checkout mark-paid, checkout waive, invite, rebook, session finish, and client booking reschedule routes.

### Commands run

```bash
grep -RIn \
  --exclude-dir=node_modules \
  --exclude-dir=.next \
  --exclude-dir=.git \
  --include='route.ts' \
  "console\.error([^,]*,[[:space:]]*error[)]" app/api/pro/bookings app/api/bookings
```

Result: no matches. The raw `console.error(..., error)` pattern is absent from
the scoped booking route files.

```bash
pnpm vitest run \
  app/api/pro/bookings/route.test.ts \
  'app/api/pro/bookings/[id]/route.test.ts' \
  'app/api/pro/bookings/[id]/cancel/route.test.ts' \
  'app/api/pro/bookings/[id]/final-review/route.test.ts' \
  'app/api/pro/bookings/[id]/consultation-services/route.test.ts' \
  'app/api/pro/bookings/[id]/checkout/mark-paid/route.test.ts' \
  'app/api/pro/bookings/[id]/checkout/waive/route.test.ts' \
  'app/api/pro/bookings/[id]/invite/route.test.ts' \
  'app/api/pro/bookings/[id]/rebook/route.test.ts' \
  'app/api/pro/bookings/[id]/session/finish/route.test.ts' \
  'app/api/bookings/[id]/reschedule/route.test.ts'
```

Result: 11 test files passed, 153 tests passed.

```bash
pnpm typecheck
```

Result: passed.

### Limitations

- Local only. CI run for the same suite is not yet recorded here.
- Staging deploy verification not yet recorded.
- Production verification not yet recorded.
- Grep is scoped to `app/api/pro/bookings` and `app/api/bookings` and to the
  pattern `console.error(..., error)`. Other call patterns (for example
  `console.error('message', { ...payload })`) and other directories (notably
  `lib/booking/writeBoundary.ts`) are not covered by this proof. A follow-up
  ticket covers `logHoldCreateInternalError` sanitation.

---

## Proof run — contact lookup hash decision documented

- Checklist item: SHA-256 vs HMAC contact hash decision documented.
- Owner: Tori Morales
- Date: 2026-05-23
- Related commits:
  - `9ff31e3` — `Repair launch-readiness test-proof.md evidence record`
    (added the truncated threat-model stub that was previously staged)
  - `0abef2f` — `Complete contact lookup hash threat model`
- Status: Decision recorded; code still uses SHA-256.
- Environment:
  - Local: yes (doc-only)
  - CI: N/A (doc-only)
  - Staging: N/A (doc-only)
  - Production: N/A (doc-only)

### Test summary

This is a documentation proof, not a code proof. It records that the
launch-time decision for contact lookup hashing has been written down and
linked from the sprint-1 verification checklist.

Decision (see `docs/security/contact-lookup-hash-threat-model.md` for full
rationale):

- Current implementation: plain SHA-256 over normalized contact field.
- Risk: bounded — internal-only use, scoped to operator/DB compromise.
- Accepted for private beta / early controlled launch.
- Future migration: HMAC-SHA256 with a versioned, KMS-backed key, using a
  dual-write + backfill + cut-over pattern. Out of scope for this sprint.

### Commands run

```bash
sed -n '1,220p' docs/security/contact-lookup-hash-threat-model.md
grep -n "SHA-256 vs HMAC contact hash decision documented" \
  docs/launch-readiness/sprint-1-verification-checklist.md
```

Result: file exists, fences closed, trailing newline present; checklist
row "SHA-256 vs HMAC contact hash decision documented" is `IN PROGRESS`
and points at the threat-model doc.

### Limitations

- This proof covers the documented decision only. No code has changed.
  `lib/security/crypto/hashLookup.ts` still uses SHA-256.
- The HMAC-SHA256 migration is intentionally deferred. It is not tracked
  by this proof and remains an open future ticket.
- No CI/staging/prod runs apply — this is documentation, not runtime
  behavior.
