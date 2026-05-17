-- supabase/migrations/20260514180000_storage_media_bucket_policies.sql
--
-- Sprint 3: Storage policy-as-code for TOVIS media buckets.
--
-- Buckets:
-- - media-public: public renderable assets. Public reads are allowed.
-- - media-private: private pro/client/verification media. No public reads, lists,
--   inserts, updates, or deletes through normal Storage API access.
--
-- Access model:
-- - App/server code uses the Supabase service role/admin client to create signed
--   upload/read URLs after TOVIS app-level auth and ownership checks.
-- - Normal anon/authenticated Storage API access is intentionally minimal.

insert into storage.buckets (id, name, public)
values
  ('media-public', 'media-public', true),
  ('media-private', 'media-private', false)
on conflict (id) do update
set
  name = excluded.name,
  public = excluded.public;

alter table storage.objects enable row level security;

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

-- Allow anonymous/public reads only for public media.
create policy "media-public public read"
on storage.objects
for select
to public
using (
  bucket_id = 'media-public'
);

-- No insert/update/delete policies are created for media-public or media-private.
-- Result:
-- - direct public reads from media-public are allowed;
-- - direct reads from media-private are denied because no allow policy matches;
-- - direct writes/updates/deletes are denied because no allow policy exists;
-- - server/service-role operations and signed URL flows remain app-controlled.