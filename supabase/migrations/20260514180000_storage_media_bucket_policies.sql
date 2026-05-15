-- supabase/migrations/20260514180000_storage_media_bucket_policies.sql
--
-- Sprint 3: Storage policy-as-code for TOVIS media buckets.
--
-- Buckets:
-- - media-public: public renderable assets. Public reads are allowed.
-- - media-private: private pro/client/verification media. No public reads, lists,
--   inserts, updates, or deletes. Access should happen through server/admin
--   signed URLs only.
--
-- Important:
-- These policies protect normal Storage API access. Server-side service-role
-- operations and signed upload/read URLs are managed separately by Supabase.

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

create policy "media-public public read"
on storage.objects
for select
to public
using (
  bucket_id = 'media-public'
);

-- Explicit deny policies for media-private.
-- RLS denies by default when no permissive policy matches, but these named
-- policies document the intended boundary in the database itself.
create policy "media-private no public read"
on storage.objects
as restrictive
for select
to public
using (
  bucket_id <> 'media-private'
);

create policy "media-private no public insert"
on storage.objects
as restrictive
for insert
to public
with check (
  bucket_id <> 'media-private'
);

create policy "media-private no public update"
on storage.objects
as restrictive
for update
to public
using (
  bucket_id <> 'media-private'
)
with check (
  bucket_id <> 'media-private'
);

create policy "media-private no public delete"
on storage.objects
as restrictive
for delete
to public
using (
  bucket_id <> 'media-private'
);