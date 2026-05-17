# Storage Policy Proof

Status: In progress  
Last verified: TODO  
Related migration: `supabase/migrations/20260514180000_storage_media_bucket_policies.sql`

## Buckets

| Bucket | Purpose | Public read | Direct client write | Expected access model |
|---|---|---:|---:|---|
| `media-public` | Public profile, portfolio, service, viral-request media | Yes | No by default | Server route creates signed upload URL; public URL may render after DB write |
| `media-private` | Booking/session/review/verification private media | No | No by default | Server route creates signed upload/read URLs after app auth checks |

## App-level storage guards

| Surface | File | Current guard |
|---|---|---|
| Pro upload init | `app/api/pro/uploads/route.ts` | Resolves upload bucket by kind: `media-public` or `media-private` |
| Pro booking session media | `app/api/pro/bookings/[id]/media/route.ts` | Requires `media-private`; requires path prefix `bookings/<bookingId>/<phase>/`; checks object exists before DB write |
| Pro media posts | `app/api/pro/media/route.ts` | Public media must use `media-public`; private pro/client media must use `media-private` |
| Client review media | `app/api/client/reviews/[id]/media/route.ts` | Validates storage pointers and verifies object existence |
| Pro verification docs | `app/api/pro/verification-docs/route.ts` | Requires `supabase://media-private/...` |
| Admin verification open | `app/api/admin/verification-docs/open/route.ts` | Admin route parses storage pointer and creates signed read URL |
| URL rendering | `lib/media/renderUrls.ts` | Central render helper for storage-backed media URLs |

## Required proof cases

| Case | Expected result | Status |
|---|---|---|
| Anonymous direct read from `media-private` | Denied | TODO |
| Anonymous direct list from `media-private` | Denied | TODO |
| Anonymous direct write to `media-private` | Denied | TODO |
| Anonymous direct update/delete in `media-private` | Denied | TODO |
| Anonymous direct read from `media-public` | Allowed | TODO |
| Anonymous direct write to `media-public` | Denied unless signed upload URL is used | TODO |
| Pro booking session media upload uses `media-private` | Covered by route test | TODO: link test |
| Booking session media path must stay under `bookings/<bookingId>/<phase>/` | Covered by route test | TODO: link test |
| Verification docs must use `media-private` | Covered by route or manual check | TODO |
| Private media rendering happens through server-signed URL | Covered by route/helpers | TODO |

## Live verification checklist

- [ ] Apply latest Supabase migration in target environment.
- [ ] Confirm `media-public` bucket exists and is public.
- [ ] Confirm `media-private` bucket exists and is private.
- [ ] Upload a public media object through the app and confirm public render URL works.
- [ ] Upload private booking media through the app and confirm signed render URL works.
- [ ] Confirm anonymous direct URL cannot read private media.
- [ ] Confirm anonymous direct list cannot list private media.
- [ ] Confirm another Pro cannot access a different Pro booking media through app routes.
- [ ] Confirm another Client cannot access a different Client review/booking media through app routes.
- [ ] Confirm verification document public URL does not work.
- [ ] Confirm admin verification open route returns a signed URL only for authorized admin users.

## Current gaps

- [ ] Confirm Supabase RLS policy semantics are actually deny-by-default for private storage.
- [ ] Add a local SQL/static policy check.
- [ ] Add live verification instructions with exact Supabase CLI/curl commands.