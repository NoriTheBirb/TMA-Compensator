import { Injectable, Injector, effect, signal } from '@angular/core';
import type { RealtimeChannel } from '@supabase/supabase-js';

import type { LegacyTransaction } from '../models/transaction';
import type { ActiveFlowTimerPersisted } from '../models/paused-work';
import { AppStateService } from '../state/app-state.service';
import { AuthService } from './auth.service';
import { CompanionService } from './companion.service';
import { SupabaseService } from './supabase.service';
import { saoPauloDayKey } from '../utils/tz';

type DbTransactionRow = {
  id: string;
  user_id: string;
  item: string;
  type: string;
  tma: number;
  time_spent: number;
  sgss: string | null;
  tipo_empresa: string | null;
  finish_status: string | null;
  source: string | null;
  client_timestamp: string | null;
  assistant: any | null;
  created_at: string;
};

type DbPresenceRow = {
  user_id: string;
  active_key: string | null;
  active_item: string | null;
  active_type: string | null;
  active_started_at: string | null;
  active_base_seconds: number | null;
  active_tma: number | null;
  updated_at: string;
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

  private lastUserFacingErrorAtMs = 0;

  constructor(
    private readonly sb: SupabaseService,
    private readonly auth: AuthService,
    private readonly companion: CompanionService,
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

  private toIsoOrNull(raw: unknown): string | null {
    const s = String(raw ?? '').trim();
    if (!s) return null;
    const ms = Date.parse(s);
    if (!Number.isFinite(ms)) return null;
    try {
      return new Date(ms).toISOString();
    } catch {
      return null;
    }
  }

  private notifyCloudError(context: string, err: unknown): void {
    // Avoid spamming the user on repeated background sync failures.
    const now = Date.now();
    if (now - this.lastUserFacingErrorAtMs < 12_000) return;
    this.lastUserFacingErrorAtMs = now;

    const anyErr = err as any;
    const status = Number(anyErr?.status);
    const message = String(anyErr?.message || anyErr?.error || anyErr?.error_description || '').trim();
    const details = String(anyErr?.details || '').trim();

    const parts = [message, details].filter(Boolean);
    const base = parts.join(' | ') || 'Falha ao comunicar com o Supabase.';
    const extra = Number.isFinite(status) ? ` (HTTP ${status})` : '';

    try {
      this.companion.speak(`${context}: ${base}${extra}`, 'scold', { title: 'Sync', autoCloseMs: 9000 });
    } catch {
      // ignore
    }
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
    if (!this.sb.ready()) {
      console.warn('[CloudSync] Cannot start: Supabase not ready');
      return;
    }

    console.log('[CloudSync] Starting cloud sync for user:', userId);

    // Load initial snapshot.
    await this.pullAll(userId);

    // Subscribe to realtime updates.
    if (this.txChannel && this.settingsChannel) {
      console.log('[CloudSync] Realtime channels already active');
      return;
    }

    if (!this.txChannel) {
      console.log('[CloudSync] Subscribing to transactions realtime channel');
      const channel = this.sb
        .channel('tx-live')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'transactions', filter: `user_id=eq.${userId}` },
        (payload: any) => {
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
      console.log('[CloudSync] Transactions realtime channel subscribed');
    }

    if (!this.settingsChannel) {
      console.log('[CloudSync] Subscribing to settings realtime channel');
      const channel = this.sb
        .channel('settings-live')
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'settings', filter: `user_id=eq.${userId}` },
          (payload: any) => {
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
      console.log('[CloudSync] Settings realtime channel subscribed');
    }
  }

  private applyRemoteSettings(row: Partial<DbSettingsRow>): void {
    this.runRemote(() => {
      this.state.applyCloudSettings(row as DbSettingsRow);
    });
  }

  private async pullAll(userId: string): Promise<void> {
    if (!this.sb.ready()) {
      console.warn('[CloudSync] Cannot pull data: Supabase not ready');
      return;
    }

    console.log('[CloudSync] Starting initial data pull for user:', userId);

    // Settings (optional)
    try {
      const { data: settings } = await this.sb
        .supabase
        .from('settings')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();

      if (settings) {
        console.log('[CloudSync] Pulled settings successfully');
        this.runRemote(() => {
          this.state.applyCloudSettings(settings as DbSettingsRow);
        });
      } else {
        console.log('[CloudSync] No settings found for user');
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[CloudSync] failed to pull settings', e);
    }

    // Transactions
    try {
      const { data: rows, error } = await this.sb
        .supabase
        .from('transactions')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(5000);

      if (error) {
        console.error('[CloudSync] Error pulling transactions:', error);
        throw error;
      }

      const count = rows?.length || 0;
      console.log(`[CloudSync] Pulled ${count} transactions successfully`);

      const tx = (rows || []).map((r: any) => this.mapRowToTx(r as any));
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
    if (!userId) {
      console.warn('[CloudSync] Cannot upsert settings: no userId');
      return;
    }
    if (!this.sb.ready()) {
      console.warn('[CloudSync] Cannot upsert settings: Supabase not ready');
      return;
    }
    if (this.isApplyingRemote()) {
      return;
    }

    try {
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

      if (error) {
        console.error('[CloudSync] Failed to upsert settings:', error);
        this.notifyCloudError('Falha ao salvar configurações na nuvem', error);
        throw error;
      }
      
      console.log('[CloudSync] Settings upserted successfully');
    } catch (error) {
      console.error('[CloudSync] Exception upserting settings:', error);
      this.notifyCloudError('Falha ao salvar configurações na nuvem', error);
      throw error;
    }
  }

  async insertTransactionFromState(tx: LegacyTransaction): Promise<LegacyTransaction | null> {
    const userId = this.auth.userId();
    if (!userId) {
      console.warn('[CloudSync] Cannot insert transaction: no userId');
      return null;
    }
    if (!this.sb.ready()) {
      console.warn('[CloudSync] Cannot insert transaction: Supabase not ready');
      return null;
    }
    if (this.isApplyingRemote()) {
      return null;
    }

    // Only insert if it isn't already a cloud row.
    if (tx.id && !String(tx.id).startsWith('local-')) {
      return null;
    }

    const clientTimestampIso = this.toIsoOrNull((tx as any)?.timestamp);

    try {
      const { data, error } = await this.sb
        .supabase
        .from('transactions')
        .insert({
          user_id: userId,
          item: tx.item,
          type: String(tx.type),
          tma: Math.max(0, Math.floor(Number(tx.tma) || 0)),
          time_spent: Math.max(0, Math.floor(Number(tx.timeSpent) || 0)),
          sgss: String((tx as any)?.sgss || '') || null,
          tipo_empresa: String((tx as any)?.tipoEmpresa || '') || null,
          finish_status: String((tx as any)?.finishStatus || '') || null,
          source: String(tx.source || ''),
          // IMPORTANT: DB column is timestamptz; do not send empty/invalid strings.
          client_timestamp: clientTimestampIso,
          assistant: tx.assistant ?? null,
        })
        .select('*')
        .single();

      if (error) {
        console.error('[CloudSync] Failed to insert transaction:', error);
        this.notifyCloudError('Falha ao salvar conta na nuvem', error);
        throw error;
      }
      if (!data) {
        console.warn('[CloudSync] Insert succeeded but no data returned');
        return null;
      }

      console.log('[CloudSync] Transaction inserted successfully:', data.id);
      return this.mapRowToTx(data as any);
    } catch (error) {
      console.error('[CloudSync] Exception inserting transaction:', error);
      this.notifyCloudError('Falha ao salvar conta na nuvem', error);
      throw error;
    }
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

  /**
   * Best-effort presence row so Admin can see "conta em progresso".
   * Not critical to core functionality.
   */
  async upsertPresenceFromState(active: ActiveFlowTimerPersisted | null): Promise<void> {
    const userId = this.auth.userId();
    if (!userId) return;
    if (!this.sb.ready()) return;

    const nowIso = new Date().toISOString();
    const startedAtIso = active ? new Date(Number(active.start) || Date.now()).toISOString() : null;

    const row: DbPresenceRow = {
      user_id: userId,
      active_key: active ? String(active.key || '') || null : null,
      active_item: active ? String(active.item || '') || null : null,
      active_type: active ? String(active.type || '') || null : null,
      active_started_at: startedAtIso,
      active_base_seconds: active ? Math.max(0, Math.floor(Number(active.baseSeconds) || 0)) : null,
      active_tma: active ? Math.max(0, Math.floor(Number((active as any)?.tma) || 0)) : null,
      updated_at: nowIso,
    };

    try {
      const { error } = await this.sb.supabase.from('user_presence').upsert(row, { onConflict: 'user_id' });
      if (error) throw error;
    } catch (e) {
      // Non-fatal; keep quiet (admin view will just not show in-progress).
      // eslint-disable-next-line no-console
      console.warn('[CloudSync] presence upsert failed', e);
    }
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
    const type = String((row as any)?.type || '');
    const isTimeTracker = type === 'time_tracker';
    const rawDifference = timeSpent - tma;
    const difference = isTimeTracker ? 0 : rawDifference;
    const creditedMinutes = isTimeTracker ? 0 : Math.round(Math.abs(rawDifference) / 60);
    const createdAtIso = String((row as any)?.created_at || '');
    const dayKey = createdAtIso ? saoPauloDayKey(createdAtIso) : '';

    return {
      id: String((row as any)?.id || ''),
      createdAtIso,
      dayKey: dayKey || undefined,
      item: String((row as any)?.item || ''),
      type,
      tma,
      timeSpent,
      difference,
      creditedMinutes,
      timestamp: String((row as any)?.client_timestamp || ''),
      sgss: String((row as any)?.sgss || '') || undefined,
      tipoEmpresa: String((row as any)?.tipo_empresa || '') || undefined,
      finishStatus: String((row as any)?.finish_status || '') || undefined,
      source: String((row as any)?.source || ''),
      assistant: ((row as any)?.assistant as any) ?? null,
    };
  }
}
