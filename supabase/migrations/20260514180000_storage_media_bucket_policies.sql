-- supabase/migrations/20260514180000_storage_media_bucket_policies.sql
--
-- Storage policy-as-code for TOVIS media buckets (deny-by-default model).
--
-- ┌─ WHY THIS LIVES HERE AND NOT IN prisma/migrations ─────────────────────────┐
-- │ storage.objects / storage.buckets are owned by `supabase_storage_admin`,   │
-- │ not by the app's Prisma migration role. Putting storage DDL in a Prisma    │
-- │ migration would either no-op or hard-fail `prisma migrate deploy` and      │
-- │ block ALL deploys. So storage policy is managed on the Supabase side and   │
-- │ applied separately (see "HOW TO APPLY" below). This file is the source of  │
-- │ truth for what the buckets' RLS posture SHOULD be.                         │
-- └────────────────────────────────────────────────────────────────────────────┘
--
-- ┌─ ACCESS MODEL (must match docs/launch-readiness/storage-policy-proof.md) ──┐
-- │ - media-public : public renderable assets. Public reads allowed (the       │
-- │                  bucket's public=true flag serves them via /object/public/;│
-- │                  the SELECT policy below is the belt-and-suspenders form).  │
-- │ - media-private: private booking/session/verification media. NO anon or    │
-- │                  authenticated read/list/insert/update/delete. Deny-by-     │
-- │                  default: we create NO policy for it, so nothing matches    │
-- │                  and every direct op is refused.                            │
-- │                                                                             │
-- │ All real access goes through the app's service-role admin client           │
-- │ (lib/supabaseAdmin.ts), which signs short-lived upload/read URLs AFTER      │
-- │ TOVIS app-level auth + ownership checks. The service role bypasses RLS, so  │
-- │ media-private deliberately needs no permissive policy.                      │
-- │                                                                             │
-- │ ⚠ Do NOT add an authenticated/anon INSERT or SELECT policy to media-private │
-- │   to "fix" upload errors. The signed-upload 403 ("new row violates RLS")    │
-- │   is a client bug: the uploader POSTed to the signed-upload endpoint, which │
-- │   ignores the token and runs the write as the anon role; it must PUT (the   │
-- │   token authorizes a PUT and bypasses RLS). Fixed in                        │
-- │   lib/media/uploadWithProgress.ts — NOT here. A wrong predicate here would  │
-- │   expose private client/pro photos.                                         │
-- └────────────────────────────────────────────────────────────────────────────┘
--
-- ┌─ HOW TO APPLY (reviewed by Tori before any prod run) ──────────────────────┐
-- │ Preferred: `supabase db push` (or the Supabase platform migration runner)  │
-- │ against the target project so it runs with storage-owner privileges.       │
-- │                                                                             │
-- │ Fallback: paste this file into the Supabase Dashboard → SQL Editor. If      │
-- │ `create policy ... on storage.objects` raises                              │
-- │   ERROR: 42501 must be owner of table objects                              │
-- │ then the SQL-editor role lacks storage ownership in this project: create    │
-- │ the single media-public SELECT policy via Dashboard → Storage → Policies    │
-- │ instead (same predicate). media-private needs no UI step (deny-by-default). │
-- │                                                                             │
-- │ This script is idempotent — safe to re-run.                                 │
-- └────────────────────────────────────────────────────────────────────────────┘

-- 1. Bucket flags. Idempotent upsert. media-public is publicly readable;
--    media-private is never public.
insert into storage.buckets (id, name, public)
values
  ('media-public', 'media-public', true),
  ('media-private', 'media-private', false)
on conflict (id) do update
set
  name = excluded.name,
  public = excluded.public;

-- 2. Ensure RLS is on for storage.objects. Supabase enables this by default,
--    so we only ALTER when it is somehow off — this avoids an unnecessary
--    privileged DDL on every run and keeps the script re-runnable.
do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'storage.objects'::regclass) then
    execute 'alter table storage.objects enable row level security';
  end if;
end
$$;

-- 3. Drop any prior TOVIS-named policies so re-runs are clean. (No-ops if absent.)
drop policy if exists "media-public public read" on storage.objects;
drop policy if exists "media-public authenticated insert blocked by default" on storage.objects;
drop policy if exists "media-public authenticated update blocked by default" on storage.objects;
drop policy if exists "media-public authenticated delete blocked by default" on storage.objects;

drop policy if exists "media-private no public read" on storage.objects;
drop policy if exists "media-private no public insert" on storage.objects;
drop policy if exists "media-private no public update" on storage.objects;
drop policy if exists "media-private no public delete" on storage.objects;

drop policy if exists "media-private no direct read" on storage.objects;
drop policy if exists "media-private no direct insert" on storage.objects;
drop policy if exists "media-private no direct update" on storage.objects;
drop policy if exists "media-private no direct delete" on storage.objects;

-- 4. The ONLY policy: anonymous/public SELECT for media-public.
create policy "media-public public read"
on storage.objects
for select
to public
using (
  bucket_id = 'media-public'
);

-- 5. Intentionally NO policy for media-private and NO insert/update/delete
--    policy for either bucket. Result:
--    - direct public reads from media-public  -> allowed
--    - direct reads from media-private        -> denied (no matching policy)
--    - direct writes/updates/deletes anywhere -> denied (no matching policy)
--    - service-role signed-URL flows          -> unaffected (RLS bypassed)
