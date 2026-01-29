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

-- Time Tracker is always enabled (no code-gated unlock).
-- Clean up any legacy gating artifacts if they exist in an older DB.
drop function if exists public.enable_time_tracker(text);
drop function if exists public.disable_time_tracker(text);
drop function if exists public.disable_time_tracker();
drop table if exists public.time_tracker_codes;
alter table public.profiles drop column if exists time_tracker_enabled_at;
alter table public.profiles drop column if exists time_tracker_enabled;

-- Backwards compatible: if the table already existed, add the column.
alter table public.profiles
  add column if not exists is_admin boolean not null default false;

create unique index if not exists profiles_username_unique
  on public.profiles (lower(username));



-- Transactions
create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  item text not null,
  type text not null,
  tma integer not null default 0,
  time_spent integer not null default 0,
  sgss text,
  tipo_empresa text,
  finish_status text,
  source text,
  client_timestamp timestamptz,
  assistant jsonb,
  created_at timestamptz not null default now()
);

alter table public.transactions add column if not exists sgss text;
alter table public.transactions add column if not exists tipo_empresa text;
alter table public.transactions add column if not exists finish_status text;



-- User presence (Flow timer in-progress)
create table if not exists public.user_presence (
  user_id uuid primary key references auth.users(id) on delete cascade,
  active_key text,
  active_item text,
  active_type text,
  active_started_at timestamptz,
  active_base_seconds integer,
  active_tma integer,
  updated_at timestamptz not null default now()
);



-- Estoque (inventory): remaining accounts available.
create table if not exists public.inventory (
  id text primary key,
  remaining integer not null default 0,
  updated_at timestamptz not null default now()
);

insert into public.inventory (id, remaining)
values ('accounts', 0)
on conflict (id) do nothing;

-- Apply a delta to the accounts inventory (SECURITY DEFINER so it works from triggers).
create or replace function public.inventory_apply_accounts_delta(delta integer)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform set_config('row_security', 'off', true);

  insert into public.inventory (id, remaining, updated_at)
  values ('accounts', 0, now())
  on conflict (id) do nothing;

  update public.inventory
  set remaining = greatest(0, remaining + coalesce(delta, 0)),
      updated_at = now()
  where id = 'accounts';
end;
$$;

-- Keep inventory in sync with account transactions.
create or replace function public.transactions_adjust_inventory()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  old_is_account boolean;
  new_is_account boolean;
begin
  perform set_config('row_security', 'off', true);

  if tg_op = 'INSERT' then
    new_is_account := lower(coalesce(new.type, '')) <> 'time_tracker';
    if new_is_account then
      perform public.inventory_apply_accounts_delta(-1);
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    old_is_account := lower(coalesce(old.type, '')) <> 'time_tracker';
    if old_is_account then
      perform public.inventory_apply_accounts_delta(1);
    end if;
    return old;
  elsif tg_op = 'UPDATE' then
    old_is_account := lower(coalesce(old.type, '')) <> 'time_tracker';
    new_is_account := lower(coalesce(new.type, '')) <> 'time_tracker';
    if old_is_account and not new_is_account then
      perform public.inventory_apply_accounts_delta(1);
    elsif (not old_is_account) and new_is_account then
      perform public.inventory_apply_accounts_delta(-1);
    end if;
    return new;
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists transactions_adjust_inventory on public.transactions;
create trigger transactions_adjust_inventory
  after insert or update or delete on public.transactions
  for each row execute function public.transactions_adjust_inventory();

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

-- Global app configuration (single row keyed by id='global')
create table if not exists public.app_config (
  id text primary key,
  sprint_mode_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

insert into public.app_config (id, sprint_mode_enabled)
values ('global', false)
on conflict (id) do nothing;

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
alter table public.user_presence enable row level security;
alter table public.inventory enable row level security;
alter table public.app_config enable row level security;
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

-- Inventory policies
drop policy if exists "inventory_select_authenticated" on public.inventory;
create policy "inventory_select_authenticated"
  on public.inventory for select
  using (auth.uid() is not null);

drop policy if exists "inventory_insert_admin" on public.inventory;
create policy "inventory_insert_admin"
  on public.inventory for insert
  with check (public.is_admin());

drop policy if exists "inventory_update_admin" on public.inventory;
create policy "inventory_update_admin"
  on public.inventory for update
  using (public.is_admin())
  with check (public.is_admin());

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


-- Policies: user_presence
drop policy if exists "user_presence_select_own" on public.user_presence;
create policy "user_presence_select_own"
  on public.user_presence for select
  using (auth.uid() = user_id);

drop policy if exists "user_presence_select_admin_all" on public.user_presence;
create policy "user_presence_select_admin_all"
  on public.user_presence for select
  using (public.is_admin());

drop policy if exists "user_presence_insert_own" on public.user_presence;
create policy "user_presence_insert_own"
  on public.user_presence for insert
  with check (auth.uid() = user_id);

drop policy if exists "user_presence_update_own" on public.user_presence;
create policy "user_presence_update_own"
  on public.user_presence for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

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

-- Policies: app_config (global)
drop policy if exists "app_config_select_authenticated" on public.app_config;
create policy "app_config_select_authenticated"
  on public.app_config for select
  using (auth.uid() is not null);

drop policy if exists "app_config_insert_admin" on public.app_config;
create policy "app_config_insert_admin"
  on public.app_config for insert
  with check (public.is_admin());

drop policy if exists "app_config_update_admin" on public.app_config;
create policy "app_config_update_admin"
  on public.app_config for update
  using (public.is_admin())
  with check (public.is_admin());

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
      and tablename = 'user_presence'
  ) then
    alter publication supabase_realtime add table public.user_presence;
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
      and tablename = 'app_config'
  ) then
    alter publication supabase_realtime add table public.app_config;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'inventory'
  ) then
    alter publication supabase_realtime add table public.inventory;
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
-- Allow profile updates (limited columns) through the API.
revoke update on table public.profiles from authenticated;
grant update (username, updated_at) on table public.profiles to authenticated;

grant select, insert, update, delete on table public.transactions to authenticated;
grant select, insert, update, delete on table public.user_presence to authenticated;
grant select, insert, update, delete on table public.settings to authenticated;

-- Inventory: everyone reads; only admins update (enforced by RLS).
grant select, insert, update on table public.inventory to authenticated;

-- Global config: everyone reads; only admins update (enforced by RLS).
grant select, insert, update on table public.app_config to authenticated;

-- Broadcasts: everyone reads, only admins can insert (enforced by RLS).
grant select, insert on table public.broadcasts to authenticated;

-- Broadcast read receipts: users insert their own; admins can read all.
grant select, insert on table public.broadcast_reads to authenticated;
