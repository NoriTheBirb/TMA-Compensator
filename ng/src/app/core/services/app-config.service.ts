import { Injectable, effect, signal } from '@angular/core';
import type { RealtimeChannel } from '@supabase/supabase-js';

import { AuthService } from './auth.service';
import { SupabaseService } from './supabase.service';

type DbAppConfigRow = {
  id: string;
  sprint_mode_enabled: boolean;
  updated_at: string;
};

const GLOBAL_CONFIG_ID = 'global';

@Injectable({ providedIn: 'root' })
export class AppConfigService {
  readonly sprintModeEnabled = signal<boolean>(false);

  private channel: RealtimeChannel | null = null;

  constructor(
    private readonly sb: SupabaseService,
    private readonly auth: AuthService,
  ) {
    effect(() => {
      if (!this.sb.ready()) {
        this.stop();
        this.sprintModeEnabled.set(false);
        return;
      }
      if (!this.auth.isAuthenticated() || !this.auth.userId()) {
        this.stop();
        this.sprintModeEnabled.set(false);
        return;
      }

      void this.start();
    });
  }

  private stop(): void {
    try {
      this.channel?.unsubscribe();
    } catch {
      // ignore
    }
    this.channel = null;
  }

  private applyRow(row: Partial<DbAppConfigRow> | null | undefined): void {
    const enabled = Boolean((row as any)?.sprint_mode_enabled);
    this.sprintModeEnabled.set(enabled);
  }

  private async start(): Promise<void> {
    if (!this.sb.ready()) return;

    // Initial snapshot.
    try {
      const { data } = await this.sb.supabase.from('app_config').select('*').eq('id', GLOBAL_CONFIG_ID).maybeSingle();
      if (data) this.applyRow(data as any);
    } catch {
      // ignore
    }

    // Realtime updates.
    if (this.channel) return;

    try {
      const ch = this.sb
        .channel('app-config-live')
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'app_config', filter: `id=eq.${GLOBAL_CONFIG_ID}` },
          (payload: any) => {
            try {
              if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') this.applyRow(payload.new as any);
            } catch {
              // ignore
            }
          },
        );

      this.channel = ch;
      void ch.subscribe();
    } catch {
      this.channel = null;
    }
  }

  async setSprintModeEnabled(enabled: boolean): Promise<void> {
    const next = Boolean(enabled);

    if (!this.sb.ready()) {
      console.warn('[AppConfig] cannot update: Supabase not ready');
      return;
    }

    // Important: enforcement is done server-side via RLS (admins only).
    // We avoid relying on local ProfileService timing.

    try {
      const { error } = await this.sb.supabase.from('app_config').upsert({
        id: GLOBAL_CONFIG_ID,
        sprint_mode_enabled: next,
        updated_at: new Date().toISOString(),
      });
      if (error) throw error;
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[AppConfig] failed to update sprint mode', e);
    }
  }
}
