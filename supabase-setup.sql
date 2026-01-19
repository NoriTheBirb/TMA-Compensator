-- TMA Compensator - Supabase Database Setup
-- Run this SQL in your Supabase SQL Editor

-- =====================================================
-- PROFILES TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS public.profiles (
  user_id UUID PRIMARY KEY,
  username TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_admin BOOLEAN NOT NULL DEFAULT false,
  time_tracker_enabled BOOLEAN NOT NULL DEFAULT false,
  time_tracker_enabled_at TIMESTAMPTZ,
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
  source TEXT,
  client_timestamp TIMESTAMPTZ,
  assistant JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT transactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);

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

DROP POLICY IF EXISTS "Users can delete their own transactions" ON public.transactions;
CREATE POLICY "Users can delete their own transactions"
  ON public.transactions FOR DELETE
  USING (auth.uid() = user_id);

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
CREATE TABLE IF NOT EXISTS public.time_tracker_codes (
  code_hash TEXT PRIMARY KEY,
  active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  assigned_user_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT time_tracker_codes_assigned_user_id_fkey FOREIGN KEY (assigned_user_id) REFERENCES auth.users(id)
);

-- Enable RLS
ALTER TABLE public.time_tracker_codes ENABLE ROW LEVEL SECURITY;

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

-- Index for faster queries
CREATE INDEX IF NOT EXISTS idx_broadcasts_created_at ON public.broadcasts(created_at DESC);

-- Enable RLS
ALTER TABLE public.broadcasts ENABLE ROW LEVEL SECURITY;

-- Policies for broadcasts table
DROP POLICY IF EXISTS "All authenticated users can read broadcasts" ON public.broadcasts;
CREATE POLICY "All authenticated users can read broadcasts"
  ON public.broadcasts FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Admins can insert broadcasts" ON public.broadcasts;
CREATE POLICY "Admins can insert broadcasts"
  ON public.broadcasts FOR INSERT
  WITH CHECK (public.is_admin());

-- =====================================================
-- TRIGGER: Auto-create profile on signup
-- =====================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (user_id, username, is_admin, time_tracker_enabled, created_at, updated_at)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'username', SPLIT_PART(NEW.email, '@', 1)),
    false,
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
-- RPC: Enable time tracker
-- =====================================================
CREATE OR REPLACE FUNCTION public.enable_time_tracker(input_code TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  expected_code TEXT := 'TT2024';
  current_user_id UUID;
BEGIN
  current_user_id := auth.uid();
  
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  
  IF input_code != expected_code THEN
    RETURN false;
  END IF;
  
  UPDATE public.profiles
  SET 
    time_tracker_enabled = true,
    time_tracker_enabled_at = NOW(),
    updated_at = NOW()
  WHERE user_id = current_user_id;
  
  RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

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
