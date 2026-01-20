-- Supabase schema for TMA Compensator
--
-- How to use:
-- 1) Create a Supabase project
-- 2) Open SQL Editor and run this file
-- 3) Copy your Project URL + anon key into ng/src/index.html meta tags

-- UUID generation
create extension if not exists "pgcrypto";

-- Profiles (username)
create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  is_admin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Backwards compatible: if the table already existed, add the column.
alter table public.profiles
  add column if not exists is_admin boolean not null default false;

create unique index if not exists profiles_username_unique
  on public.profiles (lower(username));

-- Time Tracker mode flag (driven by special codes)
alter table public.profiles
  add column if not exists time_tracker_enabled boolean not null default false;

alter table public.profiles
  add column if not exists time_tracker_enabled_at timestamptz;

-- Special codes (hashed server-side). Users never read this table.
create table if not exists public.time_tracker_codes (
  code_hash text primary key,
  active boolean not null default true,
  notes text,
  assigned_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Transactions
create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  item text not null,
  type text not null,
  tma integer not null default 0,
  time_spent integer not null default 0,
  source text,
  client_timestamp timestamptz,
  assistant jsonb,
  created_at timestamptz not null default now()
);

create index if not exists transactions_user_created_idx
  on public.transactions (user_id, created_at desc);

-- Per-user settings (single row per user)
create table if not exists public.settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  shift_start_seconds integer not null default 28800,
  lunch_start_seconds integer,
  lunch_end_seconds integer,
  show_complexa boolean not null default false,
  dark_theme_enabled boolean not null default false,
  lunch_style_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

-- Admin broadcasts (messages to all users via the companion)
create table if not exists public.broadcasts (
  id uuid primary key default gen_random_uuid(),
  message text not null,
  kind text not null default 'info',
  created_by uuid references auth.users(id) on delete set null,
  created_by_username text,
  created_at timestamptz not null default now()
);

-- Broadcast read receipts (who has listened/seen each broadcast)
create table if not exists public.broadcast_reads (
  broadcast_id uuid not null references public.broadcasts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  seen_at timestamptz not null default now(),
  primary key (broadcast_id, user_id)
);

-- Backwards compatible: if the table already existed, add the column.
alter table public.broadcasts
  add column if not exists created_by_username text;

-- Auto-fill sender fields.
create or replace function public.broadcasts_set_sender()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if new.created_by is null then
    new.created_by := auth.uid();
  end if;

  if new.created_by_username is null or length(trim(new.created_by_username)) = 0 then
    select p.username
      into new.created_by_username
    from public.profiles p
    where p.user_id = new.created_by;
  end if;

  return new;
end;
$$;

drop trigger if exists broadcasts_set_sender on public.broadcasts;
create trigger broadcasts_set_sender
  before insert on public.broadcasts
  for each row execute function public.broadcasts_set_sender();

-- Row Level Security
alter table public.transactions enable row level security;
alter table public.settings enable row level security;
alter table public.profiles enable row level security;
alter table public.time_tracker_codes enable row level security;
alter table public.broadcasts enable row level security;
alter table public.broadcast_reads enable row level security;

-- Helper: admin check without RLS recursion.
-- SECURITY DEFINER runs as the function owner (typically postgres) and bypasses RLS
-- unless FORCE ROW LEVEL SECURITY is enabled.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select coalesce(
    (select p.is_admin from public.profiles p where p.user_id = auth.uid()),
    false
  );
$$;

-- RLS policies call public.is_admin(), so the API role must be able to EXECUTE it.
-- Safe: it only checks the current authenticated user.
grant execute on function public.is_admin() to anon, authenticated;

-- Profiles policies
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
  on public.profiles for select
  using (auth.uid() = user_id);

drop policy if exists "profiles_select_admin_all" on public.profiles;
create policy "profiles_select_admin_all"
  on public.profiles for select
  using (public.is_admin());

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Codes policies (admin-only)
drop policy if exists "tt_codes_admin_select" on public.time_tracker_codes;
create policy "tt_codes_admin_select"
  on public.time_tracker_codes for select
  using (public.is_admin());

drop policy if exists "tt_codes_admin_insert" on public.time_tracker_codes;
create policy "tt_codes_admin_insert"
  on public.time_tracker_codes for insert
  with check (public.is_admin());

drop policy if exists "tt_codes_admin_update" on public.time_tracker_codes;
create policy "tt_codes_admin_update"
  on public.time_tracker_codes for update
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "tt_codes_admin_delete" on public.time_tracker_codes;
create policy "tt_codes_admin_delete"
  on public.time_tracker_codes for delete
  using (public.is_admin());

-- Create a profile row whenever a new auth user is created.
-- We store the chosen username in raw_user_meta_data.username during signUp.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  uname text;
begin
  uname := nullif(new.raw_user_meta_data->>'username', '');
  if uname is null then
    uname := split_part(coalesce(new.email, ''), '@', 1);
  end if;

  insert into public.profiles (user_id, username, is_admin, created_at, updated_at)
  values (new.id, uname, false, now(), now())
  on conflict (user_id) do update
    set username = excluded.username,
        updated_at = now();

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Enable/disable Time Tracker mode by code.
-- Uses hashed codes stored in public.time_tracker_codes.
create or replace function public.enable_time_tracker(input_code text)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  h text;
  ok boolean;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  h := encode(
    digest(
      convert_to(lower(trim(coalesce(input_code, ''))), 'utf8'),
      'sha256'::text
    ),
    'hex'
  );
  if coalesce(length(h), 0) = 0 then
    return false;
  end if;

  select exists (
    select 1
    from public.time_tracker_codes c
    where c.code_hash = h
      and c.active = true
      and (c.assigned_user_id is null or c.assigned_user_id = auth.uid())
  )
  into ok;

  if not ok then
    return false;
  end if;

  update public.profiles
    set time_tracker_enabled = true,
        time_tracker_enabled_at = now(),
        updated_at = now()
    where user_id = auth.uid();

  return true;
end;
$$;

create or replace function public.disable_time_tracker()
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  update public.profiles
    set time_tracker_enabled = false,
        updated_at = now()
    where user_id = auth.uid();
end;
$$;

grant execute on function public.enable_time_tracker(text) to authenticated;
grant execute on function public.disable_time_tracker() to authenticated;

-- Policies: transactions
drop policy if exists "transactions_select_own" on public.transactions;
create policy "transactions_select_own"
  on public.transactions for select
  using (
    auth.uid() = user_id
    and not (
      lower(coalesce(type, '')) = 'time_tracker'
      and lower(coalesce(item, '')) = lower('Ociosidade involuntaria')
    )
  );

drop policy if exists "transactions_select_admin_all" on public.transactions;
create policy "transactions_select_admin_all"
  on public.transactions for select
  using (public.is_admin());

drop policy if exists "transactions_insert_own" on public.transactions;
create policy "transactions_insert_own"
  on public.transactions for insert
  with check (auth.uid() = user_id);

drop policy if exists "transactions_update_own" on public.transactions;
create policy "transactions_update_own"
  on public.transactions for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "transactions_delete_own" on public.transactions;
create policy "transactions_delete_own"
  on public.transactions for delete
  using (
    auth.uid() = user_id
    and not (
      lower(coalesce(type, '')) = 'time_tracker'
      and lower(coalesce(item, '')) = lower('Ociosidade involuntaria')
    )
  );

drop policy if exists "transactions_delete_admin_all" on public.transactions;
create policy "transactions_delete_admin_all"
  on public.transactions for delete
  using (public.is_admin());

-- Policies: settings
drop policy if exists "settings_select_own" on public.settings;
create policy "settings_select_own"
  on public.settings for select
  using (auth.uid() = user_id);

drop policy if exists "settings_select_admin_all" on public.settings;
create policy "settings_select_admin_all"
  on public.settings for select
  using (public.is_admin());

drop policy if exists "settings_insert_own" on public.settings;
create policy "settings_insert_own"
  on public.settings for insert
  with check (auth.uid() = user_id);

drop policy if exists "settings_update_own" on public.settings;
create policy "settings_update_own"
  on public.settings for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "settings_delete_own" on public.settings;
create policy "settings_delete_own"
  on public.settings for delete
  using (auth.uid() = user_id);

-- Policies: broadcasts
drop policy if exists "broadcasts_select_authenticated" on public.broadcasts;
create policy "broadcasts_select_authenticated"
  on public.broadcasts for select
  using (auth.uid() is not null);

drop policy if exists "broadcasts_insert_admin" on public.broadcasts;
create policy "broadcasts_insert_admin"
  on public.broadcasts for insert
  with check (
    public.is_admin()
    and auth.uid() is not null
    and (created_by is null or created_by = auth.uid())
    and length(trim(coalesce(message, ''))) > 0
  );

drop policy if exists "broadcasts_update_admin" on public.broadcasts;
create policy "broadcasts_update_admin"
  on public.broadcasts for update
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "broadcasts_delete_admin" on public.broadcasts;
create policy "broadcasts_delete_admin"
  on public.broadcasts for delete
  using (public.is_admin());

-- Policies: broadcast_reads
drop policy if exists "broadcast_reads_select_own" on public.broadcast_reads;
create policy "broadcast_reads_select_own"
  on public.broadcast_reads for select
  using (auth.uid() = user_id);

drop policy if exists "broadcast_reads_select_admin_all" on public.broadcast_reads;
create policy "broadcast_reads_select_admin_all"
  on public.broadcast_reads for select
  using (public.is_admin());

drop policy if exists "broadcast_reads_insert_own" on public.broadcast_reads;
create policy "broadcast_reads_insert_own"
  on public.broadcast_reads for insert
  with check (
    auth.uid() is not null
    and auth.uid() = user_id
  );

-- Realtime publication (so postgres_changes works)
-- Safe to re-run.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'profiles'
  ) then
    alter publication supabase_realtime add table public.profiles;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'transactions'
  ) then
    alter publication supabase_realtime add table public.transactions;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'settings'
  ) then
    alter publication supabase_realtime add table public.settings;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'broadcasts'
  ) then
    alter publication supabase_realtime add table public.broadcasts;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'broadcast_reads'
  ) then
    alter publication supabase_realtime add table public.broadcast_reads;
  end if;
end $$;

-- Grants for Supabase API roles.
-- Note: RLS still applies; grants only allow PostgREST to access tables.
grant usage on schema public to anon, authenticated;

grant select on table public.profiles to authenticated;
-- Prevent users from self-enabling Time Tracker by editing profiles directly.
revoke update on table public.profiles from authenticated;
grant update (username, updated_at) on table public.profiles to authenticated;

-- Users should not read or modify special codes from the API.
revoke all on table public.time_tracker_codes from anon, authenticated;
grant select, insert, update, delete on table public.transactions to authenticated;
grant select, insert, update, delete on table public.settings to authenticated;

-- Broadcasts: everyone reads, only admins can insert (enforced by RLS).
grant select, insert on table public.broadcasts to authenticated;

-- Broadcast read receipts: users insert their own; admins can read all.
grant select, insert on table public.broadcast_reads to authenticated;
