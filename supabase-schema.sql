-- Websites with Whimsy permanent-saving schema
-- Run this entire file in the Supabase SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (char_length(username) between 2 and 40),
  local_import_decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.boards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  board_name text not null default 'Untitled Board' check (char_length(board_name) between 1 and 100),
  theme_id text not null default 'bulletin-board',
  board_data jsonb not null,
  is_public boolean not null default false,
  status text not null default 'draft' check (status in ('draft', 'live')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists boards_user_id_idx on public.boards(user_id);
create index if not exists boards_updated_at_idx on public.boards(updated_at desc);

create or replace function public.set_updated_at()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists boards_set_updated_at on public.boards;
create trigger boards_set_updated_at before update on public.boards
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, username)
  values (new.id, coalesce(nullif(trim(new.raw_user_meta_data ->> 'username'), ''), 'member-' || left(new.id::text, 8)));
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.boards enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles for select to authenticated
using ((select auth.uid()) = id);
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles for update to authenticated
using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

drop policy if exists "boards_select_own" on public.boards;
create policy "boards_select_own" on public.boards for select to authenticated
using ((select auth.uid()) = user_id);
drop policy if exists "boards_insert_own" on public.boards;
create policy "boards_insert_own" on public.boards for insert to authenticated
with check ((select auth.uid()) = user_id);
drop policy if exists "boards_update_own" on public.boards;
create policy "boards_update_own" on public.boards for update to authenticated
using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "boards_delete_own" on public.boards;
create policy "boards_delete_own" on public.boards for delete to authenticated
using ((select auth.uid()) = user_id);

-- Create the private bucket if it does not already exist.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'board-media', 'board-media', false, 52428800,
  array['image/jpeg','image/png','image/gif','image/webp','image/avif','video/mp4','video/webm','video/ogg','video/quicktime']
)
on conflict (id) do update set public = false;

drop policy if exists "board_media_select_own" on storage.objects;
create policy "board_media_select_own" on storage.objects for select to authenticated
using (bucket_id = 'board-media' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "board_media_insert_own" on storage.objects;
create policy "board_media_insert_own" on storage.objects for insert to authenticated
with check (bucket_id = 'board-media' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "board_media_update_own" on storage.objects;
create policy "board_media_update_own" on storage.objects for update to authenticated
using (bucket_id = 'board-media' and (storage.foldername(name))[1] = (select auth.uid())::text)
with check (bucket_id = 'board-media' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "board_media_delete_own" on storage.objects;
create policy "board_media_delete_own" on storage.objects for delete to authenticated
using (bucket_id = 'board-media' and (storage.foldername(name))[1] = (select auth.uid())::text);
