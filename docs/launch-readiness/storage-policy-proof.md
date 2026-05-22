# Storage Policy Proof

Status: Verified with caveat  
Last verified: 2026-05-22  
Related migration: `supabase/migrations/20260514180000_storage_media_bucket_policies.sql`

Verification caveat: `pg_policies` did not expose `storage.objects` policies in this Supabase environment, and manual policy creation in Supabase SQL Editor failed with `ERROR: 42501 must be owner of table objects`. Because Supabase owns/manages `storage.objects`, this proof relies on static migration review plus live HTTP behavior checks. Live HTTP behavior checks passed.

Environment note: Verification output showed Supabase project ref `rqhhvuaoksuvbvlypztn`. This project ref is treated as protected/main by app safeguards. Proof objects were limited to `proof/*.txt` and were cleaned up successfully.

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