-- TMA Compensator - Supabase Database Setup
-- Run this SQL in your Supabase SQL Editor

-- UUID + hashing
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =====================================================
-- PROFILES TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS public.profiles (
  user_id UUID PRIMARY KEY,
  username TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_admin BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);

-- Enable RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- Helper: admin check WITHOUT RLS recursion
-- =====================================================
-- IMPORTANT: policies on public.profiles must NOT query public.profiles directly,
-- otherwise Postgres can raise: "infinite recursion detected in policy for relation profiles".
-- This function disables row_security inside its body to safely read the flag.
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v BOOLEAN;
BEGIN
  PERFORM set_config('row_security', 'off', true);
  SELECT p.is_admin INTO v
  FROM public.profiles p
  WHERE p.user_id = auth.uid();
  RETURN COALESCE(v, false);
END;
$$;

GRANT EXECUTE ON FUNCTION public.is_admin() TO anon, authenticated;

-- Policies for profiles table
DROP POLICY IF EXISTS "Users can read their own profile" ON public.profiles;
CREATE POLICY "Users can read their own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins can read all profiles" ON public.profiles;
CREATE POLICY "Admins can read all profiles"
  ON public.profiles FOR SELECT
  USING (public.is_admin());

DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
CREATE POLICY "Users can update their own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own profile" ON public.profiles;
CREATE POLICY "Users can insert their own profile"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- =====================================================
-- TRANSACTIONS TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS public.transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  item TEXT NOT NULL,
  type TEXT NOT NULL,
  tma INTEGER NOT NULL DEFAULT 0,
  time_spent INTEGER NOT NULL DEFAULT 0,
  sgss TEXT,
  tipo_empresa TEXT,
  finish_status TEXT,
  source TEXT,
  client_timestamp TIMESTAMPTZ,
  assistant JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT transactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);

-- Safe to re-run on older DBs:
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS sgss TEXT;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS tipo_empresa TEXT;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS finish_status TEXT;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Keep updated_at fresh automatically.
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_transactions_updated_at ON public.transactions;
CREATE TRIGGER set_transactions_updated_at
  BEFORE UPDATE ON public.transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- Indexes for better performance
CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON public.transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON public.transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_user_created ON public.transactions(user_id, created_at DESC);

-- Enable RLS
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

-- Policies for transactions table
DROP POLICY IF EXISTS "Users can read their own transactions" ON public.transactions;
CREATE POLICY "Users can read their own transactions"
  ON public.transactions FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins can read all transactions" ON public.transactions;
CREATE POLICY "Admins can read all transactions"
  ON public.transactions FOR SELECT
  USING (public.is_admin());

DROP POLICY IF EXISTS "Users can insert their own transactions" ON public.transactions;
CREATE POLICY "Users can insert their own transactions"
  ON public.transactions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own transactions" ON public.transactions;
CREATE POLICY "Users can update their own transactions"
  ON public.transactions FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Admins must be able to apply approved corrections.
DROP POLICY IF EXISTS "Admins can update all transactions" ON public.transactions;
CREATE POLICY "Admins can update all transactions"
  ON public.transactions FOR UPDATE
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Users can delete their own transactions" ON public.transactions;
CREATE POLICY "Users can delete their own transactions"
  ON public.transactions FOR DELETE
  USING (auth.uid() = user_id);

-- =====================================================
-- USER PRESENCE (Flow timer in-progress)
-- =====================================================
CREATE TABLE IF NOT EXISTS public.user_presence (
  user_id UUID PRIMARY KEY,
  active_key TEXT,
  active_item TEXT,
  active_type TEXT,
  active_started_at TIMESTAMPTZ,
  active_base_seconds INTEGER,
  active_tma INTEGER,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT user_presence_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);

ALTER TABLE public.user_presence ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read their own presence" ON public.user_presence;
CREATE POLICY "Users can read their own presence"
  ON public.user_presence FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins can read all presence" ON public.user_presence;
CREATE POLICY "Admins can read all presence"
  ON public.user_presence FOR SELECT
  USING (public.is_admin());

DROP POLICY IF EXISTS "Users can upsert their own presence" ON public.user_presence;
CREATE POLICY "Users can upsert their own presence"
  ON public.user_presence FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own presence" ON public.user_presence;
CREATE POLICY "Users can update their own presence"
  ON public.user_presence FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- =====================================================
-- CORRECTION REQUESTS (user asks admin to fix a wrong account)
-- =====================================================
CREATE TABLE IF NOT EXISTS public.correction_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  user_username TEXT,
  tx_id UUID,
  tx_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  user_message TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  admin_id UUID,
  admin_username TEXT,
  admin_note TEXT,
  patch JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  CONSTRAINT correction_requests_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT correction_requests_tx_id_fkey FOREIGN KEY (tx_id) REFERENCES public.transactions(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_correction_requests_user_id ON public.correction_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_correction_requests_status_created ON public.correction_requests(status, created_at DESC);

ALTER TABLE public.correction_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read their own correction requests" ON public.correction_requests;
CREATE POLICY "Users can read their own correction requests"
  ON public.correction_requests FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins can read all correction requests" ON public.correction_requests;
CREATE POLICY "Admins can read all correction requests"
  ON public.correction_requests FOR SELECT
  USING (public.is_admin());

DROP POLICY IF EXISTS "Users can insert their own correction requests" ON public.correction_requests;
CREATE POLICY "Users can insert their own correction requests"
  ON public.correction_requests FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins can update correction requests" ON public.correction_requests;
CREATE POLICY "Admins can update correction requests"
  ON public.correction_requests FOR UPDATE
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- =====================================================
-- ESTOQUE (Inventory)
-- =====================================================
CREATE TABLE IF NOT EXISTS public.inventory (
  id TEXT PRIMARY KEY,
  remaining INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.inventory (id, remaining)
VALUES ('accounts', 0)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.inventory ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Inventory can be read by authenticated" ON public.inventory;
CREATE POLICY "Inventory can be read by authenticated"
  ON public.inventory FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Inventory can be updated by admins" ON public.inventory;
CREATE POLICY "Inventory can be updated by admins"
  ON public.inventory FOR UPDATE
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Inventory can be inserted by admins" ON public.inventory;
CREATE POLICY "Inventory can be inserted by admins"
  ON public.inventory FOR INSERT
  WITH CHECK (public.is_admin());

-- Apply a delta to inventory; used by triggers (bypasses RLS).
CREATE OR REPLACE FUNCTION public.inventory_apply_accounts_delta(delta INTEGER)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM set_config('row_security', 'off', true);

  INSERT INTO public.inventory (id, remaining, updated_at)
  VALUES ('accounts', 0, NOW())
  ON CONFLICT (id) DO NOTHING;

  UPDATE public.inventory
  SET remaining = GREATEST(0, remaining + COALESCE(delta, 0)),
      updated_at = NOW()
  WHERE id = 'accounts';
END;
$$;

-- Keep inventory in sync with account transactions.
CREATE OR REPLACE FUNCTION public.transactions_adjust_inventory()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  old_is_account BOOLEAN;
  new_is_account BOOLEAN;
BEGIN
  PERFORM set_config('row_security', 'off', true);

  IF TG_OP = 'INSERT' THEN
    new_is_account := LOWER(COALESCE(NEW.type, '')) <> 'time_tracker';
    IF new_is_account THEN
      PERFORM public.inventory_apply_accounts_delta(-1);
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    old_is_account := LOWER(COALESCE(OLD.type, '')) <> 'time_tracker';
    IF old_is_account THEN
      PERFORM public.inventory_apply_accounts_delta(1);
    END IF;
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    old_is_account := LOWER(COALESCE(OLD.type, '')) <> 'time_tracker';
    new_is_account := LOWER(COALESCE(NEW.type, '')) <> 'time_tracker';

    IF old_is_account AND NOT new_is_account THEN
      PERFORM public.inventory_apply_accounts_delta(1);
    ELSIF (NOT old_is_account) AND new_is_account THEN
      PERFORM public.inventory_apply_accounts_delta(-1);
    END IF;

    RETURN NEW;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS transactions_adjust_inventory ON public.transactions;
CREATE TRIGGER transactions_adjust_inventory
  AFTER INSERT OR UPDATE OR DELETE ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.transactions_adjust_inventory();

-- =====================================================
-- TIME TRACKER CODES (hashed, server-side)
-- =====================================================
-- Time Tracker gating removed (TT is always enabled).
-- Cleanup for older DBs (safe to re-run):
DROP FUNCTION IF EXISTS public.enable_time_tracker(TEXT);
DROP FUNCTION IF EXISTS public.disable_time_tracker(TEXT);
DROP FUNCTION IF EXISTS public.disable_time_tracker();
DROP TABLE IF EXISTS public.time_tracker_codes;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS time_tracker_enabled_at;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS time_tracker_enabled;

-- =====================================================
-- SETTINGS TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS public.settings (
  user_id UUID PRIMARY KEY,
  shift_start_seconds INTEGER NOT NULL DEFAULT 28800,
  lunch_start_seconds INTEGER,
  lunch_end_seconds INTEGER,
  show_complexa BOOLEAN NOT NULL DEFAULT false,
  dark_theme_enabled BOOLEAN NOT NULL DEFAULT false,
  lunch_style_enabled BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT settings_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);

-- =====================================================
-- GLOBAL APP CONFIG (Sprint Mode)
-- =====================================================
CREATE TABLE IF NOT EXISTS public.app_config (
  id TEXT PRIMARY KEY,
  sprint_mode_enabled BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.app_config (id, sprint_mode_enabled)
VALUES ('global', false)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "app_config_select_authenticated" ON public.app_config;
CREATE POLICY "app_config_select_authenticated"
  ON public.app_config FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "app_config_insert_admin" ON public.app_config;
CREATE POLICY "app_config_insert_admin"
  ON public.app_config FOR INSERT
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "app_config_update_admin" ON public.app_config;
CREATE POLICY "app_config_update_admin"
  ON public.app_config FOR UPDATE
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Enable RLS
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;

-- Policies for settings table
DROP POLICY IF EXISTS "Users can read their own settings" ON public.settings;
CREATE POLICY "Users can read their own settings"
  ON public.settings FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own settings" ON public.settings;
CREATE POLICY "Users can insert their own settings"
  ON public.settings FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own settings" ON public.settings;
CREATE POLICY "Users can update their own settings"
  ON public.settings FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- =====================================================
-- TIME TRACKER CODES TABLE
-- =====================================================


-- =====================================================
-- BROADCASTS TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS public.broadcasts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'info',
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by_username TEXT,
  CONSTRAINT broadcasts_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id)
);

-- =====================================================
-- BROADCAST READ RECEIPTS TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS public.broadcast_reads (
  broadcast_id UUID NOT NULL,
  user_id UUID NOT NULL,
  seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT broadcast_reads_pkey PRIMARY KEY (broadcast_id, user_id),
  CONSTRAINT broadcast_reads_broadcast_id_fkey FOREIGN KEY (broadcast_id) REFERENCES public.broadcasts(id) ON DELETE CASCADE,
  CONSTRAINT broadcast_reads_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);

-- Index for faster queries
CREATE INDEX IF NOT EXISTS idx_broadcasts_created_at ON public.broadcasts(created_at DESC);

-- Enable RLS
ALTER TABLE public.broadcasts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.broadcast_reads ENABLE ROW LEVEL SECURITY;

-- Realtime publication (so postgres_changes works)
-- Safe to re-run.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'app_config'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.app_config;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'user_presence'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.user_presence;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'inventory'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.inventory;
  END IF;
END $$;

-- Policies for broadcasts table
DROP POLICY IF EXISTS "All authenticated users can read broadcasts" ON public.broadcasts;
CREATE POLICY "All authenticated users can read broadcasts"
  ON public.broadcasts FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Admins can insert broadcasts" ON public.broadcasts;
CREATE POLICY "Admins can insert broadcasts"
  ON public.broadcasts FOR INSERT
  WITH CHECK (public.is_admin());

-- Policies for broadcast_reads table
DROP POLICY IF EXISTS "Users can read their own broadcast reads" ON public.broadcast_reads;
CREATE POLICY "Users can read their own broadcast reads"
  ON public.broadcast_reads FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins can read all broadcast reads" ON public.broadcast_reads;
CREATE POLICY "Admins can read all broadcast reads"
  ON public.broadcast_reads FOR SELECT
  USING (public.is_admin());

DROP POLICY IF EXISTS "Users can insert their own broadcast reads" ON public.broadcast_reads;
CREATE POLICY "Users can insert their own broadcast reads"
  ON public.broadcast_reads FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL AND auth.uid() = user_id);

-- =====================================================
-- TRIGGER: Auto-create profile on signup
-- =====================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (user_id, username, is_admin, created_at, updated_at)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'username', SPLIT_PART(NEW.email, '@', 1)),
    false,
    NOW(),
    NOW()
  )
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop existing trigger if it exists
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- Create trigger
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();



-- =====================================================
-- Grant necessary permissions
-- =====================================================
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated;

-- =====================================================
-- Create first admin user (OPTIONAL - adjust as needed)
-- =====================================================
-- Uncomment and modify this section to create your first admin user
-- Replace 'YOUR_USER_ID_HERE' with the actual user_id from auth.users table

-- UPDATE public.profiles
-- SET is_admin = true
-- WHERE user_id = 'YOUR_USER_ID_HERE';

-- =====================================================
-- Verify setup
-- =====================================================
-- Run these queries to verify everything is set up correctly:

-- SELECT * FROM public.profiles;
-- SELECT * FROM public.transactions LIMIT 10;
-- SELECT * FROM public.settings;
-- SELECT * FROM public.broadcasts;

NOTIFY pgrst, 'reload schema';
