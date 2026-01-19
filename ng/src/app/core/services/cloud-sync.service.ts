import { Injectable, Injector, effect, signal } from '@angular/core';
import type { RealtimeChannel } from '@supabase/supabase-js';

import type { LegacyTransaction } from '../models/transaction';
import { AppStateService } from '../state/app-state.service';
import { AuthService } from './auth.service';
import { SupabaseService } from './supabase.service';

type DbTransactionRow = {
  id: string;
  user_id: string;
  item: string;
  type: string;
  tma: number;
  time_spent: number;
  source: string | null;
  client_timestamp: string | null;
  assistant: any | null;
  created_at: string;
};

type DbSettingsRow = {
  user_id: string;
  shift_start_seconds: number;
  lunch_start_seconds: number | null;
  lunch_end_seconds: number | null;
  show_complexa: boolean;
  dark_theme_enabled: boolean;
  lunch_style_enabled: boolean;
  updated_at: string;
};

@Injectable({ providedIn: 'root' })
export class CloudSyncService {
  private readonly applyingRemote = signal(false);
  private txChannel: RealtimeChannel | null = null;
  private settingsChannel: RealtimeChannel | null = null;

  constructor(
    private readonly sb: SupabaseService,
    private readonly auth: AuthService,
    private readonly injector: Injector,
  ) {
    effect(() => {
      if (!this.sb.ready()) {
        this.stop();
        return;
      }
      const userId = this.auth.userId();
      if (userId) void this.start(userId);
      else this.stop();
    });
  }

  /** Allows AppStateService to avoid re-upload loops when applying remote updates. */
  isApplyingRemote(): boolean {
    return this.applyingRemote();
  }

  private get state(): AppStateService {
    return this.injector.get(AppStateService);
  }

  private stop(): void {
    try {
      this.txChannel?.unsubscribe();
    } catch {
      // ignore
    }
    this.txChannel = null;

    try {
      this.settingsChannel?.unsubscribe();
    } catch {
      // ignore
    }
    this.settingsChannel = null;
  }

  private async start(userId: string): Promise<void> {
    if (!this.sb.ready()) return;

    // Load initial snapshot.
    await this.pullAll(userId);

    // Subscribe to realtime updates.
    if (this.txChannel && this.settingsChannel) return;

    if (!this.txChannel) {
      const channel = this.sb
        .channel('tx-live')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'transactions', filter: `user_id=eq.${userId}` },
        payload => {
          try {
            if (payload.eventType === 'INSERT') this.applyRemoteInsert(payload.new as any);
            if (payload.eventType === 'DELETE') this.applyRemoteDelete(payload.old as any);
            if (payload.eventType === 'UPDATE') this.applyRemoteUpdate(payload.new as any);
          } catch {
            // ignore
          }
        },
      );

      this.txChannel = channel;
      void channel.subscribe();
    }

    if (!this.settingsChannel) {
      const channel = this.sb
        .channel('settings-live')
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'settings', filter: `user_id=eq.${userId}` },
          payload => {
            try {
              if (payload.eventType === 'INSERT') this.applyRemoteSettings(payload.new as any);
              if (payload.eventType === 'UPDATE') this.applyRemoteSettings(payload.new as any);
            } catch {
              // ignore
            }
          },
        );

      this.settingsChannel = channel;
      void channel.subscribe();
    }
  }

  private applyRemoteSettings(row: Partial<DbSettingsRow>): void {
    this.runRemote(() => {
      this.state.applyCloudSettings(row as DbSettingsRow);
    });
  }

  private async pullAll(userId: string): Promise<void> {
    if (!this.sb.ready()) return;

    // Settings (optional)
    try {
      const { data: settings } = await this.sb
        .supabase
        .from('settings')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();

      if (settings) {
        this.runRemote(() => {
          this.state.applyCloudSettings(settings as DbSettingsRow);
        });
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[CloudSync] failed to pull settings', e);
    }

    // Transactions
    try {
      const { data: rows } = await this.sb
        .supabase
        .from('transactions')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(5000);

      const tx = (rows || []).map(r => this.mapRowToTx(r as any));
      this.runRemote(() => {
        this.state.replaceTransactionsFromCloud(tx);
      });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[CloudSync] failed to pull transactions', e);
    }
  }

  async upsertSettingsFromState(payload: {
    shiftStartSeconds: number;
    lunchStartSeconds: number | null;
    lunchEndSeconds: number | null;
    showComplexa: boolean;
    darkThemeEnabled: boolean;
    lunchStyleEnabled: boolean;
  }): Promise<void> {
    const userId = this.auth.userId();
    if (!userId) return;
    if (!this.sb.ready()) return;
    if (this.isApplyingRemote()) return;

    const { error } = await this.sb.supabase.from('settings').upsert({
      user_id: userId,
      shift_start_seconds: payload.shiftStartSeconds,
      lunch_start_seconds: payload.lunchStartSeconds,
      lunch_end_seconds: payload.lunchEndSeconds,
      show_complexa: payload.showComplexa,
      dark_theme_enabled: payload.darkThemeEnabled,
      lunch_style_enabled: payload.lunchStyleEnabled,
      updated_at: new Date().toISOString(),
    });

    if (error) throw error;
  }

  async insertTransactionFromState(tx: LegacyTransaction): Promise<LegacyTransaction | null> {
    const userId = this.auth.userId();
    if (!userId) return null;
    if (!this.sb.ready()) return null;
    if (this.isApplyingRemote()) return null;

    // Only insert if it isn't already a cloud row.
    if (tx.id && !String(tx.id).startsWith('local-')) return null;

    const { data, error } = await this.sb
      .supabase
      .from('transactions')
      .insert({
        user_id: userId,
        item: tx.item,
        type: String(tx.type),
        tma: Math.max(0, Math.floor(Number(tx.tma) || 0)),
        time_spent: Math.max(0, Math.floor(Number(tx.timeSpent) || 0)),
        source: String(tx.source || ''),
        client_timestamp: String(tx.timestamp || ''),
        assistant: tx.assistant ?? null,
      })
      .select('*')
      .single();

    if (error) throw error;
    if (!data) return null;

    return this.mapRowToTx(data as any);
  }

  async deleteTransactionFromState(tx: LegacyTransaction): Promise<void> {
    const userId = this.auth.userId();
    const id = String(tx.id || '');
    if (!userId || !id) return;
    if (!this.sb.ready()) return;
    if (this.isApplyingRemote()) return;
    if (id.startsWith('local-')) return;

    const { error } = await this.sb.supabase.from('transactions').delete().eq('id', id).eq('user_id', userId);
    if (error) throw error;
  }

  private applyRemoteInsert(row: Partial<DbTransactionRow>): void {
    const tx = this.mapRowToTx(row);
    this.runRemote(() => {
      this.state.mergeCloudTransaction(tx);
    });
  }

  private applyRemoteUpdate(row: Partial<DbTransactionRow>): void {
    const tx = this.mapRowToTx(row);
    this.runRemote(() => {
      this.state.mergeCloudTransaction(tx);
    });
  }

  private applyRemoteDelete(row: Partial<DbTransactionRow>): void {
    const id = String((row as any)?.id || '').trim();
    if (!id) return;
    this.runRemote(() => {
      this.state.removeCloudTransactionById(id);
    });
  }

  private runRemote(fn: () => void): void {
    this.applyingRemote.set(true);
    try {
      fn();
    } finally {
      this.applyingRemote.set(false);
    }
  }

  private mapRowToTx(row: Partial<DbTransactionRow>): LegacyTransaction {
    const tma = Math.max(0, Math.floor(Number((row as any)?.tma) || 0));
    const timeSpent = Math.max(0, Math.floor(Number((row as any)?.time_spent) || 0));
    const difference = timeSpent - tma;
    const creditedMinutes = Math.round(Math.abs(difference) / 60);

    return {
      id: String((row as any)?.id || ''),
      createdAtIso: String((row as any)?.created_at || ''),
      item: String((row as any)?.item || ''),
      type: String((row as any)?.type || ''),
      tma,
      timeSpent,
      difference,
      creditedMinutes,
      timestamp: String((row as any)?.client_timestamp || ''),
      source: String((row as any)?.source || ''),
      assistant: ((row as any)?.assistant as any) ?? null,
    };
  }
}
