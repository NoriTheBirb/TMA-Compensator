import { Injectable, effect, signal } from '@angular/core';
import type { RealtimeChannel } from '@supabase/supabase-js';

import type { LegacyTransaction } from '../models/transaction';
import type { CorrectionRequest, CorrectionRequestStatus } from '../models/correction-request';
import { AuthService } from './auth.service';
import { CompanionService } from './companion.service';
import { ProfileService } from './profile.service';
import { SupabaseService } from './supabase.service';

type CorrectionRequestRow = {
  id: string;
  user_id: string;
  user_username: string | null;
  tx_id: string | null;
  tx_snapshot: any;
  user_message: string;
  status: string;
  admin_id: string | null;
  admin_username: string | null;
  admin_note: string | null;
  patch: any;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
};

function mapRowToRequest(r: any): CorrectionRequest {
  const row = (r || {}) as Partial<CorrectionRequestRow>;
  return {
    id: String(row.id || ''),
    userId: String(row.user_id || ''),
    userUsername: row.user_username ? String(row.user_username) : null,
    txId: row.tx_id ? String(row.tx_id) : null,
    txSnapshot: (row.tx_snapshot as any) ?? {},
    userMessage: String(row.user_message || ''),
    status: String(row.status || 'pending'),
    adminId: row.admin_id ? String(row.admin_id) : null,
    adminUsername: row.admin_username ? String(row.admin_username) : null,
    adminNote: row.admin_note ? String(row.admin_note) : null,
    patch: (row.patch as any) ?? null,
    createdAt: String(row.created_at || ''),
    updatedAt: String(row.updated_at || ''),
    resolvedAt: row.resolved_at ? String(row.resolved_at) : null,
  };
}

@Injectable({ providedIn: 'root' })
export class CorrectionRequestsService {
  private channel: RealtimeChannel | null = null;
  private channelKey: string = '';

  readonly lastEventAtIso = signal<string>('');

  constructor(
    private readonly sb: SupabaseService,
    private readonly auth: AuthService,
    private readonly profile: ProfileService,
    private readonly companion: CompanionService,
  ) {
    effect(() => {
      if (!this.sb.ready()) {
        this.stopRealtime();
        return;
      }

      const uid = this.auth.userId();
      if (!uid) {
        this.stopRealtime();
        return;
      }

      // Needs profile to know if this user is admin.
      const isAdmin = this.profile.isAdmin();

      const nextKey = `${uid}::${isAdmin ? 'admin' : 'user'}`;
      if (this.channel && this.channelKey === nextKey) return;

      this.stopRealtime();
      void this.startRealtime(uid, isAdmin, nextKey);
    });
  }

  private stopRealtime(): void {
    try {
      this.channel?.unsubscribe();
    } catch {
      // ignore
    }
    this.channel = null;
    this.channelKey = '';
  }

  private tryDesktopNotify(title: string, body: string): void {
    try {
      if (typeof window === 'undefined') return;
      if (!('Notification' in window)) return;

      const permission = (window as any).Notification?.permission as NotificationPermission | undefined;
      if (permission !== 'granted') {
        try {
          void (window as any).Notification?.requestPermission?.();
        } catch {
          // ignore
        }
        return;
      }

      const n = new Notification(String(title || 'Notificação'), {
        body: String(body || ''),
        tag: 'tma-correction-requests',
        silent: false,
      });

      try {
        n.onclick = () => {
          try {
            window.focus?.();
          } catch {
            // ignore
          }
          try {
            n.close?.();
          } catch {
            // ignore
          }
        };
      } catch {
        // ignore
      }
    } catch {
      // ignore
    }
  }

  private async startRealtime(userId: string, isAdmin: boolean, key: string): Promise<void> {
    if (this.channel) return;

    // Admins listen to all requests; users only listen to their own.
    const filter = isAdmin ? undefined : `user_id=eq.${userId}`;

    const ch = this.sb
      .channel('correction-requests-live')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'correction_requests', filter },
        (payload: any) => {
          try {
            this.lastEventAtIso.set(new Date().toISOString());
          } catch {
            // ignore
          }

          try {
            if (isAdmin && payload.eventType === 'INSERT') {
              const r = mapRowToRequest(payload.new);
              if (String(r.status || '') === 'pending') {
                const who = r.userUsername ? `de ${r.userUsername}` : 'de um usuário';
                this.tryDesktopNotify('Nova solicitação de correção', `${who}.`);
                this.companion.nudge(
                  `corr_req_admin_${r.id}`,
                  `Nova solicitação de correção ${who}.`,
                  'simple',
                  { title: 'Noir', autoCloseMs: 9000 },
                );
              }
            }

            if (!isAdmin && payload.eventType === 'UPDATE') {
              const r = mapRowToRequest(payload.new);
              const status = String(r.status || '').toLowerCase();
              if (status === 'approved' || status === 'rejected') {
                const adminName = r.adminUsername ? String(r.adminUsername) : 'Admin';
                const label = status === 'approved' ? 'aprovada' : 'rejeitada';
                this.tryDesktopNotify('Solicitação de correção', `${label} por ${adminName}.`);
                this.companion.nudge(
                  `corr_req_user_${r.id}_${status}`,
                  `Sua solicitação foi ${label} por ${adminName}.`,
                  'simple',
                  { title: 'Noir', autoCloseMs: 9000 },
                );
              }
            }
          } catch {
            // ignore
          }
        },
      );

    this.channel = ch;
    this.channelKey = key;
    try {
      await ch.subscribe();
    } catch {
      // ignore
    }
  }

  async deleteRequest(requestIdRaw: string): Promise<{ ok: boolean; error?: string }> {
    const uid = this.auth.userId();
    if (!uid) return { ok: false, error: 'Sem login.' };
    if (!this.sb.ready()) return { ok: false, error: 'Supabase não configurado.' };

    const requestId = String(requestIdRaw || '').trim();
    if (!requestId) return { ok: false, error: 'Solicitação inválida.' };

    try {
      const { error } = await this.sb.supabase
        .from('correction_requests')
        .delete()
        .eq('id', requestId);

      if (error) return { ok: false, error: String((error as any)?.message || 'Falha ao excluir solicitação.') };
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Falha ao excluir solicitação.' };
    }
  }

  async createRequest(input: { tx: LegacyTransaction; message: string }): Promise<{ ok: boolean; error?: string }>
  {
    const uid = this.auth.userId();
    if (!uid) return { ok: false, error: 'Sem login.' };
    if (!this.sb.ready()) return { ok: false, error: 'Supabase não configurado.' };

    const msg = String(input.message || '').trim();
    if (!msg) return { ok: false, error: 'Explique o que precisa corrigir.' };

    const tx = input.tx as any;
    const txId = String(tx?.id || '').trim();
    // Only allow requests for cloud rows (admin needs a real UUID to update).
    if (!txId || txId.startsWith('local-')) {
      return { ok: false, error: 'Essa conta ainda não sincronizou (sem ID). Aguarde alguns segundos e tente de novo.' };
    }

    const snapshot = {
      id: txId,
      item: String(tx?.item || ''),
      type: String(tx?.type || ''),
      tma: Math.max(0, Math.floor(Number(tx?.tma) || 0)),
      timeSpent: Math.max(0, Math.floor(Number(tx?.timeSpent) || 0)),
      finishStatus: String(tx?.finishStatus || ''),
      sgss: String(tx?.sgss || ''),
      tipoEmpresa: String(tx?.tipoEmpresa || ''),
      timestamp: String(tx?.timestamp || ''),
      createdAtIso: String(tx?.createdAtIso || ''),
      dayKey: String(tx?.dayKey || ''),
      source: String(tx?.source || ''),
    };

    try {
      const { error } = await this.sb.supabase.from('correction_requests').insert({
        user_id: uid,
        user_username: this.profile.username() || null,
        tx_id: txId,
        tx_snapshot: snapshot,
        user_message: msg,
        status: 'pending',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      if (error) return { ok: false, error: String((error as any)?.message || 'Falha ao enviar solicitação.') };
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Falha ao enviar solicitação.' };
    }
  }

  async fetchMyRequests(): Promise<CorrectionRequest[]> {
    const uid = this.auth.userId();
    if (!uid) return [];
    if (!this.sb.ready()) return [];

    try {
      const { data } = await this.sb.supabase
        .from('correction_requests')
        .select('*')
        .eq('user_id', uid)
        .order('created_at', { ascending: false })
        .limit(200);

      return (data || []).map(mapRowToRequest).filter(r => r.id);
    } catch {
      return [];
    }
  }

  async fetchAllRequests(): Promise<CorrectionRequest[]> {
    if (!this.sb.ready()) return [];

    try {
      const { data } = await this.sb.supabase
        .from('correction_requests')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500);

      return (data || []).map(mapRowToRequest).filter(r => r.id);
    } catch {
      return [];
    }
  }

  async resolveRequest(input: {
    requestId: string;
    txId: string;
    status: 'approved' | 'rejected';
    adminNote?: string;
    patch?: {
      item?: string;
      type?: string;
      tma?: number;
      timeSpent?: number;
      finishStatus?: string;
      clientTimestampIso?: string | null;
      sgss?: string;
      tipoEmpresa?: string;
      startedAtIso?: string | null;
      endedAtIso?: string | null;
    };
  }): Promise<{ ok: boolean; error?: string }>
  {
    const uid = this.auth.userId();
    if (!uid) return { ok: false, error: 'Sem login.' };
    if (!this.sb.ready()) return { ok: false, error: 'Supabase não configurado.' };

    const requestId = String(input.requestId || '').trim();
    const txId = String(input.txId || '').trim();
    if (!requestId || !txId) return { ok: false, error: 'Solicitação inválida.' };

    const status = String(input.status || '').trim().toLowerCase() as CorrectionRequestStatus;
    if (status !== 'approved' && status !== 'rejected') return { ok: false, error: 'Status inválido.' };

    const adminUsername = this.profile.username() || null;
    const note = String(input.adminNote || '').trim();

    const patch = input.patch || {};

    try {
      if (status === 'approved') {
        // Apply patch to the transaction.
        const updateTx: any = {
          updated_at: new Date().toISOString(),
        };
        if (typeof patch.item === 'string') updateTx.item = String(patch.item);
        if (typeof patch.type === 'string') updateTx.type = String(patch.type);
        if (typeof patch.tma === 'number' && Number.isFinite(patch.tma)) updateTx.tma = Math.max(0, Math.floor(patch.tma));
        if (typeof patch.timeSpent === 'number' && Number.isFinite(patch.timeSpent)) updateTx.time_spent = Math.max(0, Math.floor(patch.timeSpent));
        if (typeof patch.finishStatus === 'string') updateTx.finish_status = String(patch.finishStatus) || null;
        if (typeof patch.sgss === 'string') updateTx.sgss = String(patch.sgss) || null;
        if (typeof patch.tipoEmpresa === 'string') updateTx.tipo_empresa = String(patch.tipoEmpresa) || null;
        if (typeof patch.clientTimestampIso !== 'undefined') updateTx.client_timestamp = patch.clientTimestampIso ? String(patch.clientTimestampIso) : null;

        // Persist admin start/end inside assistant metadata (non-breaking).
        if (typeof patch.startedAtIso !== 'undefined' || typeof patch.endedAtIso !== 'undefined') {
          updateTx.assistant = {
            correction: {
              startedAtIso: patch.startedAtIso ?? null,
              endedAtIso: patch.endedAtIso ?? null,
            },
          };
        }

        const { error: txErr } = await this.sb.supabase.from('transactions').update(updateTx).eq('id', txId);
        if (txErr) return { ok: false, error: String((txErr as any)?.message || 'Falha ao atualizar transação.') };
      }

      // Update request status.
      const { error: reqErr } = await this.sb.supabase
        .from('correction_requests')
        .update({
          status,
          admin_id: uid,
          admin_username: adminUsername,
          admin_note: note || null,
          patch: patch || null,
          resolved_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', requestId);

      if (reqErr) return { ok: false, error: String((reqErr as any)?.message || 'Falha ao atualizar solicitação.') };
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Falha ao resolver solicitação.' };
    }
  }
}
