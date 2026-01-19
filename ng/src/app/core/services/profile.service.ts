import { Injectable, computed, effect, signal } from '@angular/core';

import { AuthService } from './auth.service';
import { SupabaseService } from './supabase.service';

type ProfileRow = {
  user_id: string;
  username: string;
  is_admin: boolean;
  time_tracker_enabled: boolean;
  time_tracker_enabled_at: string | null;
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
  readonly timeTrackerEnabled = computed(() => Boolean(this.profile()?.time_tracker_enabled));

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
        time_tracker_enabled: Boolean(row.time_tracker_enabled),
        time_tracker_enabled_at: row.time_tracker_enabled_at ? String(row.time_tracker_enabled_at) : null,
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

  async enableTimeTracker(code: string): Promise<boolean> {
    if (!this.sb.ready()) throw new Error('Supabase não configurado.');
    const userId = this.auth.userId();
    if (!userId) throw new Error('Você não está logado.');

    const input = String(code || '').trim();
    if (!input) return false;

    const { data, error } = await this.sb.supabase.rpc('enable_time_tracker', { input_code: input });

    if (error) {
      const anyErr = error as any;
      const status = Number(anyErr?.status);
      const msg = String(anyErr?.message || anyErr?.error || '').trim();
      if (status === 404) {
        throw new Error(
          [
            'RPC enable_time_tracker não encontrado (HTTP 404).',
            'Isso quase sempre significa que o schema do Supabase não foi aplicado/atualizado OU você não está autenticado.',
            'Rode supabase/schema.sql no SQL Editor e depois recarregue o schema da API (Settings → API → Restart) ou execute: NOTIFY pgrst, \'reload schema\';',
          ].join('\n'),
        );
      }

      if (status === 401 && msg.toLowerCase().includes('no api key found')) {
        throw new Error(
          [
            'Supabase recusou a requisição porque não recebeu o header apikey (HTTP 401).',
            'Isso acontece quando o app está sem o anon key em runtime.',
            'Confira se o HTML servido tem os meta tags:',
            '- <meta name="supabase-url" ...>',
            '- <meta name="supabase-anon-key" ...>',
            'Se estiver usando GitHub Pages/hosting, edite o index.html DE PRODUÇÃO e faça hard refresh (Ctrl+F5).',
          ].join('\n'),
        );
      }
      throw error;
    }

    // RPC returns boolean
    const ok = Boolean(data);
    await this.refresh();
    return ok;
  }

  async disableTimeTracker(): Promise<void> {
    if (!this.sb.ready()) throw new Error('Supabase não configurado.');
    const userId = this.auth.userId();
    if (!userId) throw new Error('Você não está logado.');

    const { error } = await this.sb.supabase.rpc('disable_time_tracker');
    if (error) throw error;
    await this.refresh();
  }
}
