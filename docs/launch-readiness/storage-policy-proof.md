# Storage Policy Proof

Status: APPLIED + VERIFIED in production (deny-by-default; signed-upload PUT fix proven)
Last verified: 2026-06-13 (live proof against project `rqhhvuaoksuvbvlypztn`)
Related migration: `supabase/migrations/20260514180000_storage_media_bucket_policies.sql`
Repeatable proof: `scripts/proof-storage-policy.mjs` (6/6 passed 2026-06-13)

> History (2026-06-13): the prior "Verified with caveat / 2026-05-22" header
> over-claimed. The migration was authored but **never applied** — it lived in
> `supabase/migrations/` (which `prisma migrate deploy` never runs) and was
> believed un-appliable due to a past `42501 must be owner of table objects` in
> the SQL editor. On 2026-06-13 a read-only check confirmed **0 policies**; the
> migration was then applied via the Supabase platform connection (which DOES
> hold storage-owner privileges — no 42501), creating exactly one policy
> (`media-public public read`). `media-private` retains **zero** policies
> (deny-by-default). All access goes through service-role signed URLs.

## Pre-apply production state (2026-06-13, read-only — before the migration)

This is the snapshot that surfaced the gap. The applied/verified state (1 policy)
is in "Live proof — applied state" below.

Source: `SELECT` against `pg_class`, `pg_policy`, `storage.buckets`, `storage.objects`
via the Supabase MCP `execute_sql` tool (read-only; no writes performed).

| Check | Value |
|---|---|
| `storage.objects` RLS enabled (`relrowsecurity`) | `true` |
| `storage.objects` RLS forced (`relforcerowsecurity`) | `false` |
| Policy count on `storage.objects` | **0** |
| `media-public` bucket `public` | `true` |
| `media-private` bucket `public` | `false` |
| Objects in `media-private` | 206 |
| Objects in `media-public` | 34 |

Interpretation: every direct anon/authenticated read/list/insert/update/delete on
`storage.objects` is refused (no permissive policy exists). The 206 private objects
were all written via the service-role signed-upload flow, which bypasses RLS. No
private object is reachable without a server-minted signed URL.

Environment note: Project ref `rqhhvuaoksuvbvlypztn` is treated as protected/main
by app safeguards. Only read-only `SELECT`s were run for this proof.

### Live proof — applied state (2026-06-13, `scripts/proof-storage-policy.mjs`, 6/6 passed)

Post-apply policy state (`pg_policy` on `storage.objects`): **1 policy** —
`media-public public read` (SELECT, role public, `bucket_id = 'media-public'`).
`media-private`: 0 policies.

| Check | Result | Evidence |
|---|---|---|
| A. Anon direct read of a real `media-private` object | Denied | `GET /object/media-private/<real path>` (apikey only) → HTTP 400 |
| A. Anon `/public/` read of a `media-private` object | Denied | HTTP 400 (bucket not public) |
| B. Service-role signed READ of `media-private` | Allowed | signed URL → HTTP 200, 516 bytes |
| C1. Signed upload via **PUT** (shipped fix) | Allowed | `PUT /object/upload/sign/media-private/...?token=` (apikey only) → HTTP 200 |
| C2. Signed upload via **POST** (the old bug) | Denied (reproduced) | same path, POST → HTTP 400 `403 new row violates row-level security policy` |
| D. Anon public read of a real `media-public` file | Allowed | `GET /object/public/media-public/<avatar>` → HTTP 200, ~1 MB |

Root cause of the BEFORE-ok / AFTER-fail session photos: the in-house uploader
POSTed to the signed-upload endpoint. That endpoint only honors the
service-role-signed token (and bypasses RLS) on **PUT**; a POST runs as the anon
role and hits `media-private`'s deny-by-default INSERT → "new row violates
row-level security policy". Fixed by switching the method to PUT in
`lib/media/uploadWithProgress.ts`. (An earlier hypothesis that the anon
`Authorization` header was the cause was disproven by C1/C2 — POST fails with or
without it; PUT succeeds with apikey alone.)

### Remaining (cannot be done from a script)

- [ ] End-to-end: a pro uploads a BEFORE **and** AFTER session photo through the
      real app UI after the PUT fix ships, and both succeed. (Storage-layer
      equivalent is proven above by C1; this is the full-stack confirmation.)

## Goal

Prove that TOVIS media storage follows the intended access model:

1. Public media can be publicly rendered.
2. Private booking/session/review/verification media cannot be directly read, listed, written, updated, or deleted by anonymous or normal client-side callers.
3. Private media is only accessible through app-controlled server routes that perform TOVIS auth/ownership checks and return short-lived signed URLs.
4. App routes use the correct bucket for each media type.
5. App routes do not create media records unless the authenticated user owns the relevant booking/review/profile surface.

## Buckets

| Bucket | Purpose | Public read | Direct client write | Expected access model |
|---|---|---:|---:|---|
| `media-public` | Public profile, portfolio, service, review, viral-request media | Yes | No by default | Server route creates signed upload URL; public URL may render after DB write |
| `media-private` | Booking/session/verification private media | No | No by default | Server route creates signed upload/read URLs after app auth checks |

## Migration summary

The storage policy migration:

- Creates/updates `media-public` with `public = true`.
- Creates/updates `media-private` with `public = false`.
- Enables RLS on `storage.objects`.
- Creates one public read policy for `media-public`.
- Creates no insert/update/delete policies for either bucket.
- Creates no direct read policy for `media-private`.

Expected result:

| Operation | Expected result |
|---|---|
| Direct public read from `media-public` | Allowed |
| Direct public read from `media-private` | Denied |
| Direct list from `media-private` | Denied or empty/no private object exposure |
| Direct insert/update/delete to either bucket | Denied unless performed through service role or signed upload flow |

## App-level storage guards

| Surface | File | Current guard | Status |
|---|---|---|---|
| Pro upload init | `app/api/pro/uploads/route.ts` | Resolves upload bucket by kind: `media-public` or `media-private` | TODO: link test |
| Pro booking session media | `app/api/pro/bookings/[id]/media/route.ts` | Requires `media-private`; requires path prefix `bookings/<bookingId>/<phase>/`; checks object exists before DB write | PASS: `app/api/pro/bookings/[id]/media/route.test.ts` |
| Pro media posts | `app/api/pro/media/route.ts` | Public media must use `media-public`; private pro/client media must use `media-private` | TODO: link test |
| Client review media create | `app/api/client/reviews/[id]/media/route.ts` | Requires owning client; requires `media-public`; validates storage pointers; verifies object existence before DB write | PASS: `app/api/client/reviews/[id]/media/route.test.ts` |
| Client review media delete | `app/api/client/reviews/[id]/media/[mediaId]/route.ts` | Requires owning client, matching review, matching uploadedByUserId, and `uploadedByRole = CLIENT`; prevents deleting portfolio/Looks media | PASS: `app/api/client/reviews/[id]/media/[mediaId]/route.test.ts` |
| Pro verification docs | `app/api/pro/verification-docs/route.ts` | Requires `supabase://media-private/...`; rejects public/raw URLs; creates pending document for authenticated Pro | PASS: `app/api/pro/verification-docs/route.test.ts` |
| Admin verification open | `app/api/admin/verification-docs/open/route.ts` | Requires admin role and scoped admin permission; requires `media-private`; returns signed URL | PASS: `app/api/admin/verification-docs/open/route.test.ts` |
| URL rendering | `lib/media/renderUrls.ts` | Public storage paths render public URLs; private storage paths render signed URLs and fail closed without raw fallback | PASS: `lib/media/renderUrls.test.ts` |

## Required proof cases

| Case | Expected result | Status | Evidence |
|---|---|---|---|
| Anonymous direct read from `media-private` | Denied | PASS | HTTP 400 with `statusCode: 404`, `Bucket not found`; body did not expose `private proof` |
| Anonymous direct list from `media-private` | Denied or no object exposure | PASS | HTTP 200 `[]`; private proof object not exposed |
| Anonymous direct write to `media-private` | Denied | PASS | HTTP 400 with `statusCode: 403`, `new row violates row-level security policy` |
| Anonymous direct update/delete in `media-private` | Denied | TODO | Add direct update/delete curl proof |
| Anonymous direct read from `media-public` | Allowed | PASS | HTTP 200, body returned `public proof` |
| Anonymous direct write to `media-public` | Denied unless signed upload URL is used | PASS | HTTP 400 with `statusCode: 403`, `new row violates row-level security policy` |
| Pro booking session media upload uses `media-private` | Covered by route test | PASS | `app/api/pro/bookings/[id]/media/route.test.ts`; run `pnpm test -- 'app/api/pro/bookings/[id]/media/route.test.ts'` |
| Booking session media path must stay under `bookings/<bookingId>/<phase>/` | Covered by route test | PASS | `app/api/pro/bookings/[id]/media/route.test.ts`; covers wrong booking id and wrong phase path rejection |
| Client review media create requires owning client | Covered by route test | PASS | `app/api/client/reviews/[id]/media/route.test.ts`; wrong client returns 403 and creates no media |
| Client review media uses `media-public` only | Covered by route test | PASS | `app/api/client/reviews/[id]/media/route.test.ts`; rejects `media-private` for review media/thumbs |
| Client review media delete requires owner/uploader match | Covered by route test | PASS | `app/api/client/reviews/[id]/media/[mediaId]/route.test.ts`; rejects wrong client, wrong review, wrong uploader, and non-client upload roles |
| Verification docs must use `media-private` | Covered by route test | PASS | `app/api/pro/verification-docs/route.test.ts`; rejects `media-public`, raw `https://...`, malformed `supabase://...`, and missing URL |
| Admin verification open requires authorized admin and `media-private` | Covered by route test | PASS | `app/api/admin/verification-docs/open/route.test.ts`; requires admin role, scoped permission, `media-private`, and signed URL |
| Private media rendering happens through server-signed URL | Covered by helper test | PASS | `lib/media/renderUrls.test.ts`; private storage pointers use signed URLs and do not fall back to raw URLs if signing fails |

---

## Static migration proof

Run:

```bash
grep -n "media-public\\|media-private\\|enable row level security\\|create policy" supabase/migrations/20260514180000_storage_media_bucket_policies.sql