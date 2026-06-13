# Change Record — Storage RLS reconciliation + signed-upload header fix

Date: 2026-06-13
Owner: Tori (launch-readiness)
Author of change: Claude (under Tori review)
Area(s): **Media storage** (safety-critical, per handoff.md change-control rule)
Status: **APPLIED to production 2026-06-13 (Tori-authorized); 6/6 live proofs passed.** Code + docs landed in repo.

## Summary

The 2026-06-12 deployed smoke proof surfaced two distinct issues, now reconciled,
applied, and proven:

1. **Storage policy-as-code was never applied to production.** The intended
   migration existed but lived in `supabase/migrations/`, which the Prisma
   deploy pipeline never runs; a past `42501 must be owner of table objects` in
   the SQL editor had led the team to believe it was un-appliable. Production
   therefore had **RLS enabled + 0 policies**. Applied 2026-06-13 via the
   Supabase platform connection (which holds storage-owner privileges — no
   42501); now **1 policy** (`media-public public read`), `media-private` still 0.

2. **A pro's AFTER session photo failed with "new row violates row-level
   security policy"** while the BEFORE photo on the same booking succeeded.
   Root cause (confirmed by `scripts/diag-signed-upload.mjs` against prod): the
   in-house uploader sent the bytes via **HTTP POST**. The signed-upload endpoint
   only honors the service-role-signed token (and bypasses RLS) on **PUT**; a
   POST runs as the anon role and hits `media-private`'s deny-by-default INSERT.
   Fixed by switching the method to PUT. (An earlier hypothesis blaming the anon
   `Authorization` header was disproven: POST fails with or without it, PUT
   succeeds with apikey alone.)

Critically, issue 1 is **not an exposure** — RLS-on + zero-policies is
deny-by-default, and `media-public.public = true` serves public reads without
RLS. The documented access model was already in force. Issue 2 is a genuine
client bug fixed independently of any policy.

## Decision

Per Tori (2026-06-13): **Option A — deny-by-default**, matching
`storage-policy-proof.md`. No authenticated/anon insert or read policies are
added to `media-private`. All real access stays on the service-role signed-URL
path. (The task brief's parenthetical suggesting authenticated insert/read
policies was explicitly rejected as unnecessary and exposure-risky.)

## Implementation reference

| Change | File |
|---|---|
| Use **PUT** (not POST) for the signed upload; keep `apikey`, no Authorization | `lib/media/uploadWithProgress.ts` |
| Test locking in PUT + token-only behavior | `lib/media/uploadWithProgress.test.ts` (new) |
| Refreshed deny-by-default migration + apply-path notes | `supabase/migrations/20260514180000_storage_media_bucket_policies.sql` |
| Repeatable production proof (anon-deny, signed-read, PUT/POST, public-read) | `scripts/proof-storage-policy.mjs` (new) |
| Real production evidence + correction of prior overclaim | `docs/launch-readiness/storage-policy-proof.md` |
| Checklist rows corrected and marked applied/verified | `docs/launch-readiness/checklist.md` |

Applied to production: migration `storage_media_bucket_policies_deny_by_default`
via the Supabase platform connection on 2026-06-13.

## Test evidence

- `pnpm vitest run lib/media/uploadWithProgress.test.ts` → 3 passed (asserts
  method is **PUT**, `apikey` present, `Authorization` absent, token in URL,
  `x-upsert:false`).
- `pnpm vitest run "app/pro/bookings/[id]/session/MediaUploader.test.tsx"` →
  5 passed (no regression; component mocks the uploader).
- `pnpm typecheck` → clean.
- **Live production proof** `scripts/proof-storage-policy.mjs` (2026-06-13) → 6/6:
  - A. anon read of a real `media-private` object → HTTP 400 (denied)
  - B. service-role signed read of `media-private` → HTTP 200, 516 bytes
  - C1. signed upload via **PUT** (shipped fix) → HTTP 200
  - C2. signed upload via **POST** (old behavior) → HTTP 400 `new row violates row-level security policy` (bug reproduced)
  - D. anon public read of a real `media-public` file → HTTP 200, ~1 MB
- Diagnostic matrix `scripts/diag-signed-upload.mjs` (2026-06-13): PUT succeeds
  with apikey-only and with the SDK; POST fails with or without the anon bearer;
  service-role credentials bypass RLS even on POST. This isolates **method** as
  the cause.
- Post-apply policy state (`pg_policy`): 1 policy `media-public public read`;
  `media-private` 0 policies.

## Known risks

- **Wrong predicate on `media-private` would expose private client/pro photos.**
  Mitigation: migration creates NO media-private policy at all (deny-by-default);
  the only policy is `media-public public read`. Verified post-apply (proof A/B).
- The storage-layer upload fix is proven (proof C1). Full-stack confirmation —
  a pro uploading BEFORE+AFTER through the real app UI after the PUT fix ships —
  is the one remaining item (see storage-policy-proof.md "Remaining").
- The `/object/upload/sign` endpoint's POST-vs-PUT behavior is storage-api
  version dependent (POST used to honor the token; it no longer does). If
  Supabase changes it again, `scripts/proof-storage-policy.mjs` will catch a
  regression — wire it into the deployed smoke proof.

## Rollback notes

- **Code (`uploadWithProgress.ts`)**: revert the single commit. The prior
  behavior (POST) is what produced the failures, so rollback restores the bug
  but is otherwise safe — no data shape change.
- **Migration**: deny-by-default was already the prod state, so the apply only
  added the redundant `media-public public read` policy. To undo, run
  `drop policy if exists "media-public public read" on storage.objects;`
  (public reads continue via the bucket `public=true` flag). Do NOT
  `alter table storage.objects disable row level security` — that WOULD open
  private media; never roll back RLS itself.

## Checklist update

Updated `docs/launch-readiness/checklist.md`:
- "Supabase Storage bucket/policy migration as code" → PASS DEPLOYED (applied 2026-06-13).
- "Media-private restrictive policy baseline" → PASS DEPLOYED (deny-by-default verified, proof A/B).
- "Media-public policy baseline" → PASS DEPLOYED (policy applied; proof D).
- "Live Supabase bucket policy verification" → PASS DEPLOYED (6/6 proof); residual full-UI BEFORE/AFTER check noted.
