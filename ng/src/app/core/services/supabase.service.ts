import { Injectable, signal } from '@angular/core';
import { createClient, type RealtimeChannel, type SupabaseClient, type Session } from '@supabase/supabase-js';

import { readSupabaseRuntimeConfig } from '../config/supabase.runtime-config';

@Injectable({ providedIn: 'root' })
export class SupabaseService {
  private readonly client: SupabaseClient | null = null;
  readonly session = signal<Session | null>(null);
  readonly ready = signal<boolean>(false);
  readonly initError = signal<string>('');

  constructor() {
    const cfg = readSupabaseRuntimeConfig();
    const url = String(cfg.url || '').trim();
    const anonKey = String(cfg.anonKey || '').trim();
    if (!url || !anonKey) {
      this.initError.set(
        'Supabase não configurado. Preencha os meta tags supabase-url e supabase-anon-key em ng/src/index.html.',
      );
      this.ready.set(false);
      return;
    }

    this.client = createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
      realtime: {
        params: { eventsPerSecond: 10 },
      },
    });

    this.ready.set(true);

    void this.client.auth.getSession().then(({ data }) => {
      this.session.set(data.session ?? null);
    });

    this.client.auth.onAuthStateChange((_event, session) => {
      this.session.set(session ?? null);
    });
  }

  get supabase(): SupabaseClient {
    if (!this.client) {
      throw new Error(this.initError() || 'Supabase não configurado.');
    }
    return this.client;
  }

  channel(name: string): RealtimeChannel {
    return this.supabase.channel(name);
  }
}
