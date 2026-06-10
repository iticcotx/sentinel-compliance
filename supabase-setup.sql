-- ===========================================================================
-- Sentinel — Supabase setup. Run this in Supabase: SQL Editor -> New query -> Run.
-- (Fake/demo data, so policies are permissive. Tighten before using real data.)
-- ===========================================================================

-- 1) table: uploaded documents (item_id -> public URL)
create table if not exists public.uploads (
  item_id    text primary key,
  url        text not null,
  name       text,
  created_at timestamptz default now()
);

-- 2) table: synced app edits/notes/watchlist (single JSON blob)
create table if not exists public.app_state (
  id   text primary key,
  data jsonb
);

-- 3) allow the anonymous (browser) key to read/write these demo tables
alter table public.uploads   enable row level security;
alter table public.app_state enable row level security;

create policy "anon all uploads"   on public.uploads   for all to anon using (true) with check (true);
create policy "anon all app_state" on public.app_state for all to anon using (true) with check (true);

-- ===========================================================================
-- 4) STORAGE bucket for the actual files:
--    Dashboard -> Storage -> New bucket -> name "uploads" -> PUBLIC bucket -> Save.
--    Then run the storage policies below so phone uploads (anon) are allowed:
-- ===========================================================================
create policy "anon upload to uploads bucket"
  on storage.objects for insert to anon
  with check (bucket_id = 'uploads');

create policy "anon read uploads bucket"
  on storage.objects for select to anon
  using (bucket_id = 'uploads');

create policy "anon update uploads bucket"
  on storage.objects for update to anon
  using (bucket_id = 'uploads') with check (bucket_id = 'uploads');
