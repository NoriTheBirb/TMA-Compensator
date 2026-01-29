import { Injectable, computed, type Signal } from '@angular/core';
import type { Session, User } from '@supabase/supabase-js';

import { SupabaseService } from './supabase.service';

@Injectable({ providedIn: 'root' })
export class AuthService {
  readonly session: Signal<Session | null>;
  readonly user: Signal<User | null>;
  readonly userId: Signal<string | null>;
  readonly isAuthenticated: Signal<boolean>;
  readonly supabaseReady: Signal<boolean>;
  readonly supabaseInitError: Signal<string>;

  constructor(private readonly sb: SupabaseService) {
    this.session = this.sb.session;
    this.user = computed(() => this.session()?.user ?? null);
    this.userId = computed(() => this.user()?.id ?? null);
    this.isAuthenticated = computed(() => Boolean(this.userId()));
    this.supabaseReady = this.sb.ready;
    this.supabaseInitError = this.sb.initError;
  }

  private ensureReady(): void {
    if (!this.sb.ready()) {
      throw new Error(this.sb.initError() || 'Supabase não configurado.');
    }
  }

  private normalizeUsername(raw: string): string {
    return String(raw || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '');
  }

  private sanitizeEmailLocalPart(username: string): string {
    const cleaned = this.normalizeUsername(username)
      .replace(/[^a-z0-9._-]/g, '-')
      .replace(/^[._-]+/, '')
      .replace(/[._-]+$/, '');
    return cleaned;
  }

  private getAuthEmailDomain(): string {
    try {
      const el = document.querySelector('meta[name="auth-email-domain"]') as HTMLMetaElement | null;
      const v = String(el?.content || '').trim().toLowerCase();
      if (v) return v;
    } catch {
      // ignore
    }

    // Default: derive from the Supabase project URL host.
    // This avoids reserved/example domains and plays nicely with domain allow-lists.
    try {
      const el = document.querySelector('meta[name="supabase-url"]') as HTMLMetaElement | null;
      const raw = String(el?.content || '').trim();
      if (raw) {
        const host = new URL(raw).host;
        if (host) return host.toLowerCase();
      }
    } catch {
      // ignore
    }

    // Safe fallback: syntactically valid domain (email is never shown to the user).
    return 'tma.local';
  }

  private usernameToEmail(username: string): string {
    const local = this.sanitizeEmailLocalPart(username);
    if (!local) return '';

    // Keep it simple and validator-friendly.
    return `${local}@${this.getAuthEmailDomain()}`;
  }

  async signUpWithUsernamePassword(username: string, password: string): Promise<{ signedIn: boolean; email: string }> {
    this.ensureReady();
    const u = this.normalizeUsername(username);
    const p = String(password || '');
    const email = this.usernameToEmail(u);
    if (!email) {
      throw new Error('Usuário inválido (não consegui gerar um identificador de login).');
    }
    const { data, error } = await this.sb.supabase.auth.signUp({
      email,
      password: p,
      options: {
        data: { username: u },
      },
    });
    if (error) {
      throw new Error(`Supabase signup failed for generated email "${email}": ${error.message}`);
    }

    // Create profile entry if user was created successfully
    if (data?.user) {
      try {
        const { error: profileError } = await this.sb.supabase
          .from('profiles')
          .insert({
            user_id: data.user.id,
            username: u,
            is_admin: false,
            updated_at: new Date().toISOString(),
          });
        
        if (profileError) {
          // Log but don't fail the signup - profile might already exist or be created by trigger
          console.warn('[AuthService] Failed to create profile:', profileError);
        }
      } catch (profileErr) {
        // Log but don't fail the signup
        console.warn('[AuthService] Exception creating profile:', profileErr);
      }
    }

    return { signedIn: Boolean(data?.session), email };
  }

  async signInWithUsernamePassword(username: string, password: string): Promise<void> {
    this.ensureReady();
    const email = this.usernameToEmail(username);
    if (!email) {
      throw new Error('Usuário inválido (não consegui gerar um identificador de login).');
    }
    const { error } = await this.sb.supabase.auth.signInWithPassword({
      email,
      password: String(password || ''),
    });
    if (error) {
      throw new Error(`Supabase sign-in failed for generated email "${email}": ${error.message}`);
    }
  }

  // Legacy email/password methods removed (not used by the UI).

  async signOut(): Promise<void> {
    this.ensureReady();

    // Best-effort: stop realtime channels immediately so the UI calms down on logout.
    try {
      (this.sb.supabase as any)?.removeAllChannels?.();
    } catch {
      // ignore
    }

    // Prefer the default sign-out (may call the network). If that fails (offline, etc),
    // fallback to local sign-out so the app session is still cleared.
    try {
      const { error } = await this.sb.supabase.auth.signOut();
      if (error) throw error;
      return;
    } catch (e) {
      try {
        const { error } = await (this.sb.supabase.auth as any).signOut({ scope: 'local' });
        if (error) throw error;
        return;
      } catch {
        // Re-throw the original error; local signout also failed.
        throw e;
      }
    }
  }
}
