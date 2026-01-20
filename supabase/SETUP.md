# Supabase setup (TMA Compensator)

## 1) Create project
- Create a new Supabase project.
- In **Authentication → Providers**, enable **Email**.

## 2) Create tables + RLS
- Open **SQL Editor** and run: [supabase/schema.sql](schema.sql)

This creates:
- `public.transactions` (per-user rows)
- `public.settings` (1 row per user)
- RLS + policies to restrict access to `auth.uid()`
- Adds both tables to `supabase_realtime` publication for `postgres_changes`

## 3) Put keys into the app
Edit [ng/src/index.html](../ng/src/index.html) and fill:
- `<meta name="supabase-url" content="...">`
- `<meta name="supabase-anon-key" content="...">`

Optional (only if your project enforces/needs a specific email domain for Auth):
- `<meta name="auth-email-domain" content="example.com">`

You can find these in **Project Settings → API**.

Important:
- `supabase-url` must be your **Project URL**, like `https://<project-ref>.supabase.co`.
- `supabase-anon-key` must be the **public client key** (often called **anon** or **publishable**).
- Never use a key named **secret** / `sb_secret_...` / **service_role** in the browser app. If you paste that into the app or commit it, rotate it in Supabase immediately.

## Auth mode (username + password)
This project uses **Supabase Auth** for real accounts.

- The UI asks for **username + password**.
- Under the hood, Supabase still needs an email identifier, so the app generates one automatically (the user never sees it).
	- Default domain is derived from your `supabase-url` host (recommended).
	- You can override the domain with `<meta name="auth-email-domain" ...>` if you use an email-domain allowlist.

Recommended Supabase settings:
- **Authentication → Settings**: disable **Email confirmations** (so signup works immediately).
- **Authentication → Providers → Email**: ensure Email is enabled.
- **Authentication → Settings**: ensure **Signups** are enabled.

## 5) Verify realtime
- Open the app on two different computers (or one computer + incognito).
- Sign into the same user.
- Add a transaction on one → it should appear in the other (and in the Report page).

## Admin (superiors) page
There is an admin-only page at `/admin` that shows a summary of everyone’s day.

To make a user an admin:
- Go to Supabase **SQL Editor** and run:

	`update public.profiles set is_admin = true where lower(username) = lower('<username>');`

Then log in as that user and open the sidebar → **Painel (Admin)**.

## Troubleshooting
- If the app shows “Supabase não configurado…”, check the meta tags in [ng/src/index.html](../ng/src/index.html).
- If inserts fail with `new row violates row-level security policy`, your policies weren’t applied (re-run the SQL).
- If realtime doesn’t fire, ensure the publication contains the tables (schema.sql adds them).
