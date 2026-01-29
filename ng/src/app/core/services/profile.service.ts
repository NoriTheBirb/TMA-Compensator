import { Injectable, computed, effect, signal } from '@angular/core';

import { AuthService } from './auth.service';
import { SupabaseService } from './supabase.service';

type ProfileRow = {
  user_id: string;
  username: string;
  is_admin: boolean;
  updated_at: string;
};

function formatSupabaseError(e: unknown): string {
  const anyErr = e as any;
  const msg = String(anyErr?.message || anyErr?.error_description || anyErr?.error || '').trim();
  const details = String(anyErr?.details || '').trim();
  const hint = String(anyErr?.hint || '').trim();
  const code = String(anyErr?.code || '').trim();

  const parts = [msg, details, hint].filter(Boolean);
  const base = parts.join(' | ') || 'Falha ao carregar perfil.';
  return code ? `${base} (code: ${code})` : base;
}

@Injectable({ providedIn: 'root' })
export class ProfileService {
  readonly profile = signal<ProfileRow | null>(null);
  readonly loading = signal<boolean>(false);
  readonly error = signal<string>('');

  readonly username = computed(() => this.profile()?.username ?? '');
  readonly isAdmin = computed(() => Boolean(this.profile()?.is_admin));
  readonly timeTrackerEnabled = computed(() => true);

  constructor(
    private readonly sb: SupabaseService,
    private readonly auth: AuthService,
  ) {
    effect(() => {
      if (!this.sb.ready()) {
        this.profile.set(null);
        this.loading.set(false);
        this.error.set('');
        return;
      }

      const userId = this.auth.userId();
      if (!userId) {
        this.profile.set(null);
        this.loading.set(false);
        this.error.set('');
        return;
      }

      void this.refresh();
    });
  }

  async refresh(): Promise<void> {
    if (!this.sb.ready()) return;
    const userId = this.auth.userId();
    if (!userId) return;

    this.loading.set(true);
    this.error.set('');

    try {
      const { data, error } = await this.sb.supabase
        .from('profiles')
        // Use '*' to stay compatible if the DB schema is behind the frontend.
        // Selecting a non-existent column causes Supabase/PostgREST to return HTTP 400.
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();

      if (error) throw error;

      const row = (data as any) ?? null;
      if (!row) {
        this.profile.set(null);
        return;
      }

      this.profile.set({
        user_id: String(row.user_id || ''),
        username: String(row.username || ''),
        is_admin: Boolean(row.is_admin),
        updated_at: row.updated_at ? String(row.updated_at) : new Date().toISOString(),
      });
    } catch (e) {
      const msg = formatSupabaseError(e);
      this.error.set(msg);
      // Helpful when debugging Supabase HTTP 400/401/500.
      // eslint-disable-next-line no-console
      console.warn('[ProfileService] refresh failed', e);
      this.profile.set(null);
    } finally {
      this.loading.set(false);
    }
  }
}
