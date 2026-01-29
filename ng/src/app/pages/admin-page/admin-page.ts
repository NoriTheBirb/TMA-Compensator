import { CommonModule } from '@angular/common';
import { Component, computed, OnDestroy, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import type { RealtimeChannel } from '@supabase/supabase-js';

import { AuthService } from '../../core/services/auth.service';
import { CompanionService } from '../../core/services/companion.service';
import { AppConfigService } from '../../core/services/app-config.service';
import { ProfileService } from '../../core/services/profile.service';
import type { CorrectionRequest } from '../../core/models/correction-request';
import { CorrectionRequestsService } from '../../core/services/correction-requests.service';
import { SupabaseService } from '../../core/services/supabase.service';
import { quotaWeightForItem } from '../../core/utils/assistant';
import { drawWorkHoursByHourStacked } from '../../core/utils/report';
import { formatSignedTime, secondsToTime, timeToSeconds } from '../../core/utils/time';
import { localDayKey } from '../../core/utils/day';
import { saoPauloDayRangeIsoFromYmd, saoPauloDayKey } from '../../core/utils/tz';

type ProfileLite = {
  user_id: string;
  username: string;
  is_admin: boolean;
};

type TxLite = {
  user_id: string;
  item: string;
  type: string;
  tma: number;
  time_spent: number;
  sgss?: string | null;
  tipo_empresa?: string | null;
  created_at: string;
};

type BroadcastLite = {
  id: string;
  message: string;
  kind: string;
  created_at: string;
  created_by_username: string | null;
};

type BroadcastReadRow = {
  user_id: string;
  seen_at: string;
};

type BroadcastReadLite = {
  user_id: string;
  username: string;
  seen_at: string;
};

type PresenceLite = {
  user_id: string;
  active_key: string | null;
  active_item: string | null;
  active_type: string | null;
  active_started_at: string | null;
  active_base_seconds: number | null;
  updated_at: string;
};

type InventoryLite = {
  id: string;
  remaining: number;
  updated_at: string;
};

type TimelineSegView = {
  leftPct: number;
  widthPct: number;
  kind: 'work' | 'tt' | 'idle';
  active: boolean;
  title: string;
};

type TimelineMarkerView = {
  leftPct: number;
  kind: 'day_start' | 'day_end';
  title: string;
};

type UserDayRow = {
  userId: string;
  username: string;
  txCount: number;
  doneUnits: number;
  diffSeconds: number;
  lastTxAtIso: string | null;
};

function dayRangeIso(now: Date): { startIso: string; endIso: string } {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

function formatAnyError(e: unknown, fallback: string): string {
  try {
    if (e instanceof Error) {
      const msg = String(e.message || '').trim();
      return msg || fallback;
    }
    if (typeof e === 'string') {
      const msg = e.trim();
      return msg || fallback;
    }
    const obj = e as any;
    const msg = String(obj?.message || obj?.error_description || obj?.error || '').trim();
    if (msg) return msg;
    const json = JSON.stringify(e);
    return json && json !== '{}' ? json : fallback;
  } catch {
    return fallback;
  }
}

function pad2(n: number): string {
  const s = String(Math.floor(Number(n) || 0));
  return s.length >= 2 ? s : `0${s}`;
}

function isoToDatetimeLocalValue(iso: unknown): string {
  const s = String(iso || '').trim();
  if (!s) return '';
  const d = new Date(s);
  if (!Number.isFinite(d.getTime())) return '';
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function datetimeLocalValueToIso(value: unknown): string | null {
  const s = String(value || '').trim();
  if (!s) return null;
  const d = new Date(s);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toISOString();
}

@Component({
  selector: 'app-admin-page',
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './admin-page.html',
  styleUrl: './admin-page.css',
})
export class AdminPage {
  protected readonly sidebarOpen = signal(false);
  protected readonly sidebarClosing = signal(false);
  protected readonly sidebarShown = computed(() => this.sidebarOpen() || this.sidebarClosing());
  private sidebarCloseTimer: number | null = null;

  protected readonly loading = signal(false);
  protected readonly errorText = signal('');
  protected readonly asOfIso = signal<string>(new Date().toISOString());

  protected readonly helloName = computed(() => this.profile.username());

  protected readonly query = signal('');
  protected readonly sortKey = signal<'units' | 'accounts' | 'saldo' | 'last'>('units');
  protected readonly sortDir = signal<'asc' | 'desc'>('desc');
  protected readonly showAdmins = signal(true);

  protected readonly selectedDayYmd = signal<string>(saoPauloDayKey(new Date()));
  protected readonly selectedDayLabel = computed(() => {
    const ymd = String(this.selectedDayYmd() || '').trim();
    const today = saoPauloDayKey(new Date());
    return ymd && ymd === today ? 'Hoje' : ymd || '—';
  });
  protected readonly liveEnabled = signal(true);

  protected readonly detailsOpen = signal(false);
  protected readonly selectedUserId = signal<string | null>(null);

  protected readonly broadcastOpen = signal(false);
  protected readonly broadcastText = signal('');
  protected readonly broadcastSending = signal(false);
  protected readonly broadcastError = signal('');

  protected readonly broadcastHistoryOpen = signal(false);
  protected readonly broadcastHistoryLoading = signal(false);
  protected readonly broadcastHistoryError = signal('');
  protected readonly selectedBroadcastId = signal<string | null>(null);
  protected readonly broadcastReadsLoading = signal(false);

  protected readonly correctionOpen = signal(false);
  protected readonly correctionLoading = signal(false);
  protected readonly correctionResolving = signal(false);
  protected readonly correctionError = signal('');
  protected readonly selectedCorrectionId = signal<string | null>(null);

  private readonly correctionRows = signal<CorrectionRequest[]>([]);
  protected readonly correctionSortedRows = computed(() => {
    const rows = this.correctionRows();
    const norm = (s: unknown) => String(s || '').trim().toLowerCase();
    const rank = (s: unknown) => {
      const v = norm(s);
      if (v === 'pending') return 0;
      if (v === 'approved') return 1;
      if (v === 'rejected') return 2;
      return 3;
    };

    return [...rows].sort((a, b) => {
      const ra = rank(a.status);
      const rb = rank(b.status);
      if (ra !== rb) return ra - rb;
      const ca = String(a.createdAt || '');
      const cb = String(b.createdAt || '');
      if (ca !== cb) return cb.localeCompare(ca);
      return String(a.id || '').localeCompare(String(b.id || ''));
    });
  });
  protected readonly selectedCorrection = computed(() => {
    const id = this.selectedCorrectionId();
    if (!id) return null;
    return this.correctionRows().find(r => r.id === id) ?? null;
  });

  protected readonly corrDraftItem = signal('');
  protected readonly corrDraftType = signal('');
  protected readonly corrDraftTma = signal<string>('');
  protected readonly corrDraftTimeSpent = signal<string>('');
  protected readonly corrDraftFinishStatus = signal('');
  protected readonly corrDraftClientTimestampLocal = signal('');
  protected readonly corrDraftStartedAtLocal = signal('');
  protected readonly corrDraftEndedAtLocal = signal('');
  protected readonly corrDraftSgss = signal('');
  protected readonly corrDraftTipoEmpresa = signal('');
  protected readonly corrDraftAdminNote = signal('');

  private readonly broadcastHistory = signal<BroadcastLite[]>([]);
  private readonly broadcastReadCounts = signal<Record<string, number>>({});
  private readonly broadcastReads = signal<BroadcastReadLite[]>([]);

  private readonly profiles = signal<ProfileLite[]>([]);
  private readonly transactionsToday = signal<TxLite[]>([]);
  private readonly presence = signal<PresenceLite[]>([]);
  private readonly inventoryRow = signal<InventoryLite | null>(null);

  protected readonly inventoryRemaining = computed<number | null>(() => {
    const r = this.inventoryRow();
    if (!r) return null;
    const n = Math.floor(Number((r as any)?.remaining) || 0);
    return Number.isFinite(n) ? Math.max(0, n) : null;
  });

  protected readonly inventoryUpdatedAtIso = computed<string | null>(() => {
    const r = this.inventoryRow();
    const iso = String((r as any)?.updated_at || '').trim();
    return iso || null;
  });

  protected readonly inventoryDraft = signal<string>('');
  protected readonly inventorySaving = signal(false);
  protected readonly inventoryError = signal('');

  private realtime?: RealtimeChannel;
  private refreshTimer: number | null = null;
  private clockTimer: number | null = null;

  private readonly baseRows = computed<UserDayRow[]>(() => {
    const profiles = this.profiles();
    const tx = this.transactionsToday();

    const byUser = new Map<string, UserDayRow>();
    for (const p of profiles) {
      byUser.set(p.user_id, {
        userId: p.user_id,
        username: String(p.username || '').trim() || '(sem nome)',
        txCount: 0,
        doneUnits: 0,
        diffSeconds: 0,
        lastTxAtIso: null,
      });
    }

    for (const t of tx) {
      const row = byUser.get(t.user_id);
      if (!row) continue;

      const type = String((t as any)?.type || '').trim().toLowerCase();
      const isTimeTracker = type === 'time_tracker';

      // Dashboard "Contas/Unidades/Saldo" should refer to real accounts, not Time Tracker entries.
      if (!isTimeTracker) {
        row.txCount += 1;
        row.doneUnits += quotaWeightForItem(String(t.item || ''));
        row.diffSeconds += (Number(t.time_spent) || 0) - (Number(t.tma) || 0);
      }

      const iso = String(t.created_at || '').trim();
      if (iso) {
        // "Última conta" should be last account record.
        if (!isTimeTracker) {
          if (!row.lastTxAtIso || iso > row.lastTxAtIso) row.lastTxAtIso = iso;
        }
      }
    }

    return Array.from(byUser.values()).sort((a, b) => {
      if (a.doneUnits !== b.doneUnits) return b.doneUnits - a.doneUnits;
      if (a.txCount !== b.txCount) return b.txCount - a.txCount;
      return a.username.localeCompare(b.username);
    });
  });

  protected readonly rows = computed<UserDayRow[]>(() => {
    const q = this.query().trim().toLowerCase();
    const showAdmins = this.showAdmins();
    const sortKey = this.sortKey();
    const dir = this.sortDir();

    const profileById = new Map(this.profiles().map((p) => [p.user_id, p] as const));

    let rows = this.baseRows();

    if (!showAdmins) {
      rows = rows.filter((r) => !profileById.get(r.userId)?.is_admin);
    }

    if (q) {
      rows = rows.filter((r) => {
        const uname = String(r.username || '').toLowerCase();
        const id = String(r.userId || '').toLowerCase();
        return uname.includes(q) || id.includes(q);
      });
    }

    const sign = dir === 'asc' ? 1 : -1;
    const byLast = (iso: string | null): number => {
      if (!iso) return -1;
      const t = Date.parse(iso);
      return Number.isFinite(t) ? t : -1;
    };

    rows = [...rows].sort((a, b) => {
      switch (sortKey) {
        case 'accounts':
          return sign * (a.txCount - b.txCount);
        case 'saldo':
          return sign * (a.diffSeconds - b.diffSeconds);
        case 'last':
          return sign * (byLast(a.lastTxAtIso) - byLast(b.lastTxAtIso));
        case 'units':
        default:
          return sign * (a.doneUnits - b.doneUnits);
      }
    });

    return rows;
  });

  protected readonly kpiTotalUsers = computed(() => this.rows().length);
  protected readonly kpiTotalTx = computed(() => this.rows().reduce((acc, r) => acc + (r.txCount || 0), 0));
  protected readonly kpiTotalUnits = computed(() => this.rows().reduce((acc, r) => acc + (r.doneUnits || 0), 0));
  protected readonly kpiTotalSaldo = computed(() => this.rows().reduce((acc, r) => acc + (r.diffSeconds || 0), 0));

  protected readonly selectedProfile = computed<ProfileLite | null>(() => {
    const id = this.selectedUserId();
    if (!id) return null;
    return this.profiles().find((p) => p.user_id === id) ?? null;
  });

  protected readonly selectedRow = computed<UserDayRow | null>(() => {
    const id = this.selectedUserId();
    if (!id) return null;
    return this.baseRows().find((r) => r.userId === id) ?? null;
  });

  protected readonly selectedTx = computed<TxLite[]>(() => {
    const id = this.selectedUserId();
    if (!id) return [];
    return this.transactionsToday().filter((t) => t.user_id === id);
  });

  private readonly presenceByUser = computed(() => {
    const map = new Map<string, PresenceLite>();
    for (const p of this.presence()) {
      map.set(p.user_id, p);
    }
    return map;
  });

  protected inProgressText(userId: string): string | null {
    const p = this.presenceByUser().get(String(userId || '').trim());
    if (!p) return null;

    const updatedMs = Date.parse(String(p.updated_at || '').trim());
    if (!Number.isFinite(updatedMs)) return null;

    // Client heartbeats every ~45s; keep a little slack.
    if (Date.now() - updatedMs > 2.5 * 60 * 1000) return null;

    const key = String(p.active_key || '').trim();
    if (!key) return null;

    const item = String(p.active_item || '').trim();
    const type = String(p.active_type || '').trim();
    const suffix = [item, type].filter(Boolean).join(' • ');
    return suffix ? `Em progresso: ${suffix}` : 'Em progresso';
  }

  protected isInProgress(userId: string): boolean {
    return Boolean(this.inProgressText(userId));
  }

  protected readonly selectedBroadcast = computed<BroadcastLite | null>(() => {
    const id = this.selectedBroadcastId();
    if (!id) return null;
    return this.broadcastHistory().find((b) => b.id === id) ?? null;
  });

  protected readonly selectedBroadcastReads = computed<BroadcastReadLite[]>(() => this.broadcastReads());

  protected readonly broadcastHistoryRows = computed(() => {
    const totalUsers = this.profiles().length;
    const counts = this.broadcastReadCounts();
    return this.broadcastHistory().map((b) => {
      const seenCount = Math.max(0, Math.floor(Number(counts[b.id]) || 0));
      return {
        ...b,
        seenCount,
        totalUsers,
      };
    });
  });

  protected readonly selectedTopItems = computed(() => {
    const tx = this.selectedTx();
    const counts = new Map<string, number>();
    for (const t of tx) {
      const type = String((t as any)?.type || '').trim().toLowerCase();
      if (type === 'time_tracker') continue;
      const key = String(t.item || '').trim() || '(vazio)';
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
  });

  protected readonly selectedTopTimeTrackerItems = computed(() => {
    const tx = this.selectedTx();
    const counts = new Map<string, number>();
    for (const t of tx) {
      const type = String((t as any)?.type || '').trim().toLowerCase();
      if (type !== 'time_tracker') continue;
      const key = String(t.item || '').trim() || '(vazio)';
      if (key === this.workdayStartItem || key === this.workdayEndItem) continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
  });

  protected readonly selectedAvgDiff = computed(() => {
    const row = this.selectedRow();
    if (!row || !row.txCount) return 0;
    return row.diffSeconds / row.txCount;
  });

  private readonly ttType = 'time_tracker';
  private readonly involuntaryIdleItem = 'Ociosidade involuntaria';
  private readonly workdayStartItem = 'Início do dia';
  private readonly workdayEndItem = 'Fim do dia';

  private readonly selectedDayRangeMs = computed(() => {
    const ymd = String(this.selectedDayYmd() || '').trim() || saoPauloDayKey(new Date());
    const { startIso, endIso } = saoPauloDayRangeIsoFromYmd(ymd);
    const startMs = Date.parse(startIso);
    const endMs = Date.parse(endIso);
    return { ymd, startIso, endIso, startMs, endMs };
  });

  protected readonly timelineNowPct = computed<number | null>(() => {
    // Tie to refresh timestamp so it updates when realtime refresh fires.
    void this.asOfIso();

    const today = saoPauloDayKey(new Date());
    const { ymd, startMs, endMs } = this.selectedDayRangeMs();
    if (ymd !== today) return null;
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return null;

    const now = Date.now();
    const clamped = Math.max(startMs, Math.min(endMs, now));
    const pct = ((clamped - startMs) / (endMs - startMs)) * 100;
    return Math.max(0, Math.min(100, pct));
  });

  protected readonly timelineDayPart = computed<number | null>(() => {
    const nowPct = this.timelineNowPct();
    if (nowPct === null) return null;
    const idx = Math.floor(nowPct / 25);
    return Math.max(0, Math.min(3, idx));
  });

  private readonly timelineByUser = computed(() => {
    const { startMs, endMs } = this.selectedDayRangeMs();
    const rangeMs = endMs - startMs;

    const result = new Map<string, TimelineSegView[]>();
    for (const p of this.profiles()) {
      result.set(p.user_id, []);
    }

    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || rangeMs <= 0) return result;

    const clamp = (t: number) => Math.max(startMs, Math.min(endMs, t));
    const pct = (t: number) => ((t - startMs) / rangeMs) * 100;
    const minWidthPct = 0.6;

    const kindFor = (typeRaw: unknown, itemRaw: unknown): 'work' | 'tt' | 'idle' => {
      const type = String(typeRaw || '').trim().toLowerCase();
      const item = String(itemRaw || '').trim();
      if (type === this.ttType) {
        if (item === this.involuntaryIdleItem) return 'idle';
        return 'tt';
      }
      return 'work';
    };

    for (const t of this.transactionsToday()) {
      const userId = String((t as any)?.user_id || '').trim();
      if (!userId) continue;

      const endAtMs = Date.parse(String((t as any)?.created_at || '').trim());
      if (!Number.isFinite(endAtMs)) continue;

      const spentSeconds = Math.max(0, Math.floor(Number((t as any)?.time_spent) || 0));
      const startAtMs = endAtMs - spentSeconds * 1000;

      const s = clamp(startAtMs);
      const e = clamp(endAtMs);
      if (!(e > s)) continue;

      const leftPct = Math.max(0, Math.min(100, pct(s)));
      const widthPct = Math.max(minWidthPct, Math.min(100 - leftPct, pct(e) - pct(s)));
      const kind = kindFor((t as any)?.type, (t as any)?.item);
      const title = `${String((t as any)?.item || '').trim()} • ${String((t as any)?.type || '').trim()} • ${secondsToTime(spentSeconds)}`;

      const list = result.get(userId) ?? [];
      list.push({ leftPct, widthPct, kind, active: false, title });
      result.set(userId, list);
    }

    for (const p of this.presence()) {
      const userId = String((p as any)?.user_id || '').trim();
      if (!userId) continue;

      const activeKey = String((p as any)?.active_key || '').trim();
      if (!activeKey) continue;

      const updatedAtMs = Date.parse(String((p as any)?.updated_at || '').trim());
      if (!Number.isFinite(updatedAtMs)) continue;
      if (Date.now() - updatedAtMs > 2.5 * 60 * 1000) continue;

      const startedAtMsRaw = Date.parse(String((p as any)?.active_started_at || '').trim());
      const baseSeconds = Math.max(0, Math.floor(Number((p as any)?.active_base_seconds) || 0));
      const startedAtMs = Number.isFinite(startedAtMsRaw) ? startedAtMsRaw : Number.isFinite(updatedAtMs) ? updatedAtMs - baseSeconds * 1000 : NaN;
      if (!Number.isFinite(startedAtMs)) continue;

      const s = clamp(startedAtMs);
      const e = clamp(Date.now());
      if (!(e > s)) continue;

      const leftPct = Math.max(0, Math.min(100, pct(s)));
      const widthPct = Math.max(minWidthPct, Math.min(100 - leftPct, pct(e) - pct(s)));
      const kind = kindFor((p as any)?.active_type, (p as any)?.active_item);
      const item = String((p as any)?.active_item || '').trim();
      const type = String((p as any)?.active_type || '').trim();
      const title = ['Em progresso', item, type].filter(Boolean).join(' • ');

      const list = result.get(userId) ?? [];
      list.push({ leftPct, widthPct, kind, active: true, title });
      result.set(userId, list);
    }

    for (const [userId, list] of result.entries()) {
      list.sort((a, b) => (a.leftPct - b.leftPct) || (Number(a.active) - Number(b.active)));
      result.set(userId, list);
    }

    return result;
  });

  private readonly timelineMarkersByUser = computed(() => {
    const { startMs, endMs } = this.selectedDayRangeMs();
    const rangeMs = endMs - startMs;

    const result = new Map<string, TimelineMarkerView[]>();
    for (const p of this.profiles()) {
      result.set(p.user_id, []);
    }

    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || rangeMs <= 0) return result;

    const clamp = (t: number) => Math.max(startMs, Math.min(endMs, t));
    const pct = (t: number) => ((t - startMs) / rangeMs) * 100;

    for (const t of this.transactionsToday()) {
      const userId = String((t as any)?.user_id || '').trim();
      if (!userId) continue;

      const type = String((t as any)?.type || '').trim().toLowerCase();
      if (type !== this.ttType) continue;

      const item = String((t as any)?.item || '').trim();
      if (item !== this.workdayStartItem && item !== this.workdayEndItem) continue;

      const atMs = Date.parse(String((t as any)?.created_at || '').trim());
      if (!Number.isFinite(atMs)) continue;

      const leftPct = Math.max(0, Math.min(100, pct(clamp(atMs))));
      const kind: TimelineMarkerView['kind'] = item === this.workdayEndItem ? 'day_end' : 'day_start';
      const title = item;

      const list = result.get(userId) ?? [];
      list.push({ leftPct, kind, title });
      result.set(userId, list);
    }

    for (const [userId, list] of result.entries()) {
      list.sort((a, b) => a.leftPct - b.leftPct);
      result.set(userId, list);
    }

    return result;
  });

  protected timelineSegments(userId: string): TimelineSegView[] {
    return this.timelineByUser().get(String(userId || '').trim()) ?? [];
  }

  protected timelineMarkers(userId: string): TimelineMarkerView[] {
    return this.timelineMarkersByUser().get(String(userId || '').trim()) ?? [];
  }

  protected readonly selectedTimeStats = computed(() => {
    const tx = this.selectedTx();

    let workSeconds = 0;
    let workCount = 0;
    let ttSeconds = 0;
    let ttCount = 0;
    let idleSeconds = 0;
    let idleCount = 0;

    let firstIso: string | null = null;
    let lastIso: string | null = null;

    for (const t of tx) {
      const iso = String(t.created_at || '').trim();
      if (iso) {
        if (!firstIso || iso < firstIso) firstIso = iso;
        if (!lastIso || iso > lastIso) lastIso = iso;
      }

      const type = String((t as any)?.type || '').trim().toLowerCase();
      const spent = Math.max(0, Math.floor(Number(t.time_spent) || 0));

      const itemText = String(t.item || '').trim();
      if (type === this.ttType && (itemText === this.workdayStartItem || itemText === this.workdayEndItem)) {
        continue;
      }

      if (type === this.ttType) {
        ttSeconds += spent;
        ttCount += 1;
        if (String(t.item || '').trim() === this.involuntaryIdleItem) {
          idleSeconds += spent;
          idleCount += 1;
        }
      } else {
        workSeconds += spent;
        workCount += 1;
      }
    }

    const windowSeconds = (() => {
      if (!firstIso || !lastIso) return 0;
      const a = Date.parse(firstIso);
      const b = Date.parse(lastIso);
      if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return 0;
      return Math.max(0, Math.floor((b - a) / 1000));
    })();

    const row = this.selectedRow();
    const doneUnits = Number(row?.doneUnits || 0);
    const diffSeconds = Number(row?.diffSeconds || 0);

    const totalSeconds = workSeconds + ttSeconds;
    const usefulTtSeconds = Math.max(0, ttSeconds - idleSeconds);

    const unitsPerHour = windowSeconds > 0 ? doneUnits / (windowSeconds / 3600) : 0;
    const accountsPerHour = windowSeconds > 0 ? workCount / (windowSeconds / 3600) : 0;
    const ttPctOfWindow = windowSeconds > 0 ? totalSeconds / windowSeconds : 0;
    const idlePctOfTt = ttSeconds > 0 ? idleSeconds / ttSeconds : 0;

    return {
      workSeconds,
      workCount,
      ttSeconds,
      ttCount,
      idleSeconds,
      idleCount,
      totalSeconds,
      usefulTtSeconds,
      firstIso,
      lastIso,
      windowSeconds,
      doneUnits,
      diffSeconds,
      unitsPerHour,
      accountsPerHour,
      ttPctOfWindow,
      idlePctOfTt,
    };
  });

  protected readonly selectedVisual = computed(() => {
    const s = this.selectedTimeStats();
    const total = Math.max(1, s.workSeconds + s.ttSeconds);

    const accountsPct = Math.max(0, Math.min(100, (100 * s.workSeconds) / total));
    const ttUsefulPct = Math.max(0, Math.min(100, (100 * s.usefulTtSeconds) / total));
    const idlePct = Math.max(0, Math.min(100, (100 * s.idleSeconds) / total));

    const ttWindowPct = Math.max(0, Math.min(100, 100 * (s.ttPctOfWindow || 0)));
    const idleInTtPct = Math.max(0, Math.min(100, 100 * (s.idlePctOfTt || 0)));

    // Saldo meter: clamp at ±30min for visualization.
    const saldo = Number(s.diffSeconds || 0);
    const saldoClamped = Math.max(-1800, Math.min(1800, saldo));
    const saldoMeterPct = 50 + (saldoClamped / 1800) * 50; // 0..100

    return {
      accountsPct,
      ttUsefulPct,
      idlePct,
      ttWindowPct,
      idleInTtPct,
      saldo,
      saldoMeterPct,
    };
  });

  protected readonly selectedTopByTime = computed(() => {
    const tx = this.selectedTx();
    const agg = new Map<string, { item: string; seconds: number; count: number }>();
    for (const t of tx) {
      const type = String((t as any)?.type || '').trim().toLowerCase();
      if (type === this.ttType) continue;
      const item = String(t.item || '').trim() || '(vazio)';
      const spent = Math.max(0, Math.floor(Number(t.time_spent) || 0));
      const cur = agg.get(item) || { item, seconds: 0, count: 0 };
      cur.seconds += spent;
      cur.count += 1;
      agg.set(item, cur);
    }
    return Array.from(agg.values())
      .sort((a, b) => b.seconds - a.seconds)
      .slice(0, 12)
      .map((x) => ({ ...x, avgSeconds: x.count ? Math.round(x.seconds / x.count) : 0 }));
  });

  protected readonly selectedTopTimeTrackerByTime = computed(() => {
    const tx = this.selectedTx();
    const agg = new Map<string, { item: string; seconds: number; count: number }>();
    for (const t of tx) {
      const type = String((t as any)?.type || '').trim().toLowerCase();
      if (type !== this.ttType) continue;
      const item = String(t.item || '').trim() || '(vazio)';
      if (item === this.workdayStartItem || item === this.workdayEndItem) continue;
      const spent = Math.max(0, Math.floor(Number(t.time_spent) || 0));
      const cur = agg.get(item) || { item, seconds: 0, count: 0 };
      cur.seconds += spent;
      cur.count += 1;
      agg.set(item, cur);
    }
    return Array.from(agg.values())
      .sort((a, b) => b.seconds - a.seconds)
      .slice(0, 12)
      .map((x) => ({ ...x, avgSeconds: x.count ? Math.round(x.seconds / x.count) : 0 }));
  });

  protected readonly selectedHourlyBreakdown = computed(() => {
    const tx = this.selectedTx();
    const rows = new Array(24).fill(0).map((_, hour) => ({
      hour,
      accountsSeconds: 0,
      ttSeconds: 0,
      idleSeconds: 0,
      accountsCount: 0,
      ttCount: 0,
      actions: [] as string[],
    }));

    for (const t of tx) {
      const d = new Date(t.created_at);
      const h = d.getHours();
      if (!Number.isFinite(h) || h < 0 || h > 23) continue;
      const type = String((t as any)?.type || '').trim().toLowerCase();
      const item = String(t.item || '').trim();
      const secs = Math.max(0, Math.floor(Number(t.time_spent) || 0));

      const r = rows[h];
      r.actions.push(`${item} (${this.formatTime(secs)})`);

      if (type === this.ttType) {
        r.ttSeconds += secs;
        r.ttCount += 1;
        if (item === this.involuntaryIdleItem) r.idleSeconds += secs;
      } else {
        r.accountsSeconds += secs;
        r.accountsCount += 1;
      }
    }

    return rows.map(r => ({
      ...r,
      totalSeconds: r.accountsSeconds + r.ttSeconds,
      usefulTtSeconds: Math.max(0, r.ttSeconds - r.idleSeconds),
    }));
  });

  constructor(
    private readonly sb: SupabaseService,
    private readonly auth: AuthService,
    protected readonly profile: ProfileService,
    protected readonly companion: CompanionService,
    protected readonly appConfig: AppConfigService,
    private readonly corrections: CorrectionRequestsService,
    private readonly router: Router,
  ) {
    void this.refresh();
    this.ensureRealtime();

    // Keep the timeline ("now" and active segments) moving even if no DB events fire.
    this.clockTimer = window.setInterval(() => {
      this.asOfIso.set(new Date().toISOString());
    }, 15000);
  }

  protected async saveInventory(): Promise<void> {
    if (!this.sb.ready()) {
      this.inventoryError.set('Supabase não configurado.');
      return;
    }

    const remaining = Math.max(0, Math.floor(Number(this.inventoryDraft() || 0)));
    if (!Number.isFinite(remaining)) {
      this.inventoryError.set('Valor inválido.');
      return;
    }

    this.inventorySaving.set(true);
    this.inventoryError.set('');
    try {
      const nowIso = new Date().toISOString();
      const { error } = await this.sb.supabase.from('inventory').upsert(
        { id: 'accounts', remaining, updated_at: nowIso },
        { onConflict: 'id' },
      );
      if (error) throw error;

      this.inventoryRow.set({ id: 'accounts', remaining, updated_at: nowIso });
      this.asOfIso.set(nowIso);
    } catch (e) {
      this.inventoryError.set(formatAnyError(e, 'Falha ao salvar estoque.'));
    } finally {
      this.inventorySaving.set(false);
    }
  }

  protected setSprintModeEnabled(enabled: boolean): void {
    void this.appConfig.setSprintModeEnabled(Boolean(enabled));
  }

  protected setCompanionEnabled(enabled: boolean): void {
    this.companion.setEnabled(Boolean(enabled));
  }

  protected openBroadcast(): void {
    this.broadcastError.set('');
    this.broadcastOpen.set(true);
  }

  protected openCorrectionRequests(): void {
    this.correctionError.set('');
    if (this.sidebarShown()) this.closeSidebar();
    this.correctionOpen.set(true);
    void this.refreshCorrectionRequests();
  }

  protected closeCorrectionRequests(): void {
    this.correctionOpen.set(false);
    this.correctionError.set('');
    this.selectedCorrectionId.set(null);
  }

  protected correctionStatusLabel(status: unknown): string {
    const s = String(status || '').trim().toLowerCase();
    if (s === 'pending') return 'Pendente';
    if (s === 'approved') return 'Aprovada';
    if (s === 'rejected') return 'Rejeitada';
    return String(status || '—') || '—';
  }

  protected selectCorrection(r: CorrectionRequest): void {
    const id = String(r?.id || '').trim();
    if (!id) return;
    this.selectedCorrectionId.set(id);
    this.seedCorrectionDraft(r);
  }

  private seedCorrectionDraft(r: CorrectionRequest): void {
    const snap = (r?.txSnapshot || {}) as any;

    this.corrDraftItem.set(String(snap?.item || '').trim());
    this.corrDraftType.set(String(snap?.type || '').trim());

    const tma = Math.max(0, Math.floor(Number(snap?.tma) || 0));
    const timeSpent = Math.max(0, Math.floor(Number(snap?.timeSpent) || 0));
    this.corrDraftTma.set(tma ? secondsToTime(tma) : '');
    this.corrDraftTimeSpent.set(timeSpent ? secondsToTime(timeSpent) : '');

    this.corrDraftFinishStatus.set(String(snap?.finishStatus || '').trim());
    this.corrDraftSgss.set(String(snap?.sgss || '').trim());
    this.corrDraftTipoEmpresa.set(String(snap?.tipoEmpresa || '').trim());

    const clientIso = String(snap?.timestamp || snap?.createdAtIso || '').trim();
    this.corrDraftClientTimestampLocal.set(isoToDatetimeLocalValue(clientIso));

    const patch = (r?.patch || {}) as any;
    this.corrDraftStartedAtLocal.set(isoToDatetimeLocalValue(patch?.startedAtIso));
    this.corrDraftEndedAtLocal.set(isoToDatetimeLocalValue(patch?.endedAtIso));
    this.corrDraftAdminNote.set(String(r?.adminNote || '').trim());
  }

  protected async refreshCorrectionRequests(): Promise<void> {
    if (!this.sb.ready()) {
      this.correctionError.set('Supabase não configurado.');
      return;
    }

    this.correctionLoading.set(true);
    this.correctionError.set('');
    try {
      const rows = await this.corrections.fetchAllRequests();
      this.correctionRows.set(rows);

      const selected = this.selectedCorrectionId();
      const stillExists = selected ? rows.some(r => r.id === selected) : false;
      if (!stillExists) {
        const firstPending = rows.find(r => String(r.status || '').toLowerCase() === 'pending');
        const pick = firstPending ?? rows[0] ?? null;
        if (pick) {
          this.selectedCorrectionId.set(pick.id);
          this.seedCorrectionDraft(pick);
        }
      }
    } catch (e) {
      this.correctionError.set(formatAnyError(e, 'Falha ao carregar solicitações.'));
    } finally {
      this.correctionLoading.set(false);
    }
  }

  private parseDraftNumber(value: unknown): number | undefined {
    const n = Math.floor(Number(String(value || '').trim()));
    if (!Number.isFinite(n)) return undefined;
    return Math.max(0, n);
  }

  private parseDraftSeconds(value: unknown): number | undefined {
    const raw = String(value || '').trim();
    if (!raw) return undefined;

    // If admin types a duration like "MM:SS" or "HH:MM:SS", parse it.
    if (raw.includes(':')) {
      const sec = timeToSeconds(raw);
      if (sec == null) return undefined;
      return Math.max(0, Math.floor(sec));
    }

    // Fallback: treat plain numbers as seconds.
    const n = Math.floor(Number(raw));
    if (!Number.isFinite(n)) return undefined;
    return Math.max(0, n);
  }

  protected async approveCorrection(): Promise<void> {
    const r = this.selectedCorrection();
    if (!r) return;

    const txId = String(r.txId || '').trim();
    if (!txId) {
      this.correctionError.set('Essa solicitação não tem tx_id.');
      return;
    }

    const item = String(this.corrDraftItem() || '').trim();
    const type = String(this.corrDraftType() || '').trim();
    if (!item || !type) {
      this.correctionError.set('Item e tipo são obrigatórios para aprovar.');
      return;
    }

    const tma = this.parseDraftSeconds(this.corrDraftTma());
    const timeSpent = this.parseDraftSeconds(this.corrDraftTimeSpent());

    const clientTimestampIso = datetimeLocalValueToIso(this.corrDraftClientTimestampLocal());
    const startedAtIso = datetimeLocalValueToIso(this.corrDraftStartedAtLocal());
    const endedAtIso = datetimeLocalValueToIso(this.corrDraftEndedAtLocal());

    const finishStatus = String(this.corrDraftFinishStatus() || '').trim();
    const sgss = String(this.corrDraftSgss() || '').trim();
    const tipoEmpresa = String(this.corrDraftTipoEmpresa() || '').trim();

    const patch: any = {
      item,
      type,
    };

    if (finishStatus) patch.finishStatus = finishStatus;
    if (sgss) patch.sgss = sgss;
    if (tipoEmpresa) patch.tipoEmpresa = tipoEmpresa;
    if (typeof tma === 'number') patch.tma = tma;
    if (typeof timeSpent === 'number') patch.timeSpent = timeSpent;
    if (clientTimestampIso) patch.clientTimestampIso = clientTimestampIso;
    if (startedAtIso) patch.startedAtIso = startedAtIso;
    if (endedAtIso) patch.endedAtIso = endedAtIso;

    this.correctionResolving.set(true);
    this.correctionError.set('');
    try {
      const res = await this.corrections.resolveRequest({
        requestId: r.id,
        txId,
        status: 'approved',
        adminNote: String(this.corrDraftAdminNote() || '').trim(),
        patch,
      });

      if (!res.ok) {
        this.correctionError.set(String(res.error || 'Falha ao aprovar.'));
        return;
      }

      void this.refreshCorrectionRequests();
    } finally {
      this.correctionResolving.set(false);
    }
  }

  protected async rejectCorrection(): Promise<void> {
    const r = this.selectedCorrection();
    if (!r) return;

    const txId = String(r.txId || '').trim();
    if (!txId) {
      this.correctionError.set('Essa solicitação não tem tx_id.');
      return;
    }

    this.correctionResolving.set(true);
    this.correctionError.set('');
    try {
      const res = await this.corrections.resolveRequest({
        requestId: r.id,
        txId,
        status: 'rejected',
        adminNote: String(this.corrDraftAdminNote() || '').trim(),
      });

      if (!res.ok) {
        this.correctionError.set(String(res.error || 'Falha ao rejeitar.'));
        return;
      }

      void this.refreshCorrectionRequests();
    } finally {
      this.correctionResolving.set(false);
    }
  }

  protected closeBroadcast(): void {
    this.broadcastOpen.set(false);
    this.broadcastError.set('');
  }

  protected async sendBroadcast(): Promise<void> {
    if (!this.sb.ready()) {
      this.broadcastError.set('Supabase não configurado.');
      return;
    }

    const uid = this.auth.userId();
    if (!uid) {
      this.broadcastError.set('Você não está autenticado.');
      return;
    }

    const msg = String(this.broadcastText() || '').trim();
    if (!msg) {
      this.broadcastError.set('Escreva uma mensagem.');
      return;
    }

    this.broadcastSending.set(true);
    this.broadcastError.set('');

    try {
      const { error } = await this.sb.supabase.from('broadcasts').insert({
        message: msg,
        kind: 'info',
        created_by: uid,
      });
      if (error) throw error;

      this.broadcastText.set('');
      this.broadcastOpen.set(false);
      this.companion.sayAdminBroadcastSent();
    } catch (e) {
      const err = e instanceof Error ? e.message : 'Falha ao enviar mensagem.';
      this.broadcastError.set(err);
    } finally {
      this.broadcastSending.set(false);
    }
  }

  protected openBroadcastHistory(): void {
    this.broadcastHistoryError.set('');
    if (this.sidebarShown()) this.closeSidebar();
    this.broadcastHistoryOpen.set(true);
    void this.refreshBroadcastHistory();
  }

  protected closeBroadcastHistory(): void {
    this.broadcastHistoryOpen.set(false);
    this.selectedBroadcastId.set(null);
    this.broadcastReads.set([]);
    this.broadcastHistoryError.set('');
  }

  protected selectBroadcast(b: BroadcastLite): void {
    const id = String(b?.id || '').trim();
    if (!id) return;
    this.selectedBroadcastId.set(id);
    void this.loadBroadcastReads(id);
  }

  protected async refreshBroadcastHistory(): Promise<void> {
    if (!this.sb.ready()) {
      this.broadcastHistoryError.set('Supabase não configurado.');
      return;
    }

    this.broadcastHistoryLoading.set(true);
    this.broadcastHistoryError.set('');

    try {
      const { data, error } = await this.sb.supabase
        .from('broadcasts')
        .select('id,message,kind,created_at,created_by_username')
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;

      const rows = (Array.isArray(data) ? data : []) as any[];
      const broadcasts: BroadcastLite[] = rows
        .map((r) => ({
          id: String(r?.id || '').trim(),
          message: String(r?.message || '').trim(),
          kind: String(r?.kind || 'info').trim().toLowerCase(),
          created_at: String(r?.created_at || '').trim(),
          created_by_username: r?.created_by_username ? String(r.created_by_username).trim() : null,
        }))
        .filter((b) => Boolean(b.id) && Boolean(b.message));

      this.broadcastHistory.set(broadcasts);

      // Read counts (JS aggregate).
      const ids = broadcasts.map((b) => b.id).filter(Boolean);
      if (!ids.length) {
        this.broadcastReadCounts.set({});
        return;
      }

      const { data: reads, error: readsError } = await this.sb.supabase
        .from('broadcast_reads')
        .select('broadcast_id,user_id')
        .in('broadcast_id', ids);
      if (readsError) throw readsError;

      const counts: Record<string, number> = {};
      const rr = Array.isArray(reads) ? (reads as any[]) : [];
      for (const r of rr) {
        const bid = String(r?.broadcast_id || '').trim();
        if (!bid) continue;
        counts[bid] = (counts[bid] ?? 0) + 1;
      }
      this.broadcastReadCounts.set(counts);

      if (!this.selectedBroadcastId() && broadcasts.length) {
        this.selectBroadcast(broadcasts[0]);
      }
    } catch (e) {
      this.broadcastHistoryError.set(formatAnyError(e, 'Falha ao carregar histórico.'));
    } finally {
      this.broadcastHistoryLoading.set(false);
    }
  }

  private async loadBroadcastReads(broadcastId: string): Promise<void> {
    if (!this.sb.ready()) return;

    const id = String(broadcastId || '').trim();
    if (!id) return;

    this.broadcastReadsLoading.set(true);
    this.broadcastHistoryError.set('');

    try {
      const { data, error } = await this.sb.supabase
        .from('broadcast_reads')
        .select('user_id,seen_at')
        .eq('broadcast_id', id)
        .order('seen_at', { ascending: false });
      if (error) throw error;

      const profileById = new Map(this.profiles().map((p) => [p.user_id, p] as const));
      const rows = (Array.isArray(data) ? data : []) as BroadcastReadRow[];
      const mapped: BroadcastReadLite[] = rows.map((r) => {
        const uid = String(r?.user_id || '').trim();
        const uname = profileById.get(uid)?.username;
        return {
          user_id: uid,
          username: String(uname || '').trim() || uid,
          seen_at: String(r?.seen_at || '').trim(),
        };
      });

      this.broadcastReads.set(mapped);
    } catch (e) {
      this.broadcastHistoryError.set(formatAnyError(e, 'Falha ao carregar leituras.'));
    } finally {
      this.broadcastReadsLoading.set(false);
    }
  }

  protected companionHelp(): void {
    this.companion.speak(
      'Modo admin: eu posso te ajudar a interpretar o painel (ritmo, TT, idle).\n\nSe quiser, dá pra adicionar também um botão de “mensagem para todos” e eu aviso todo mundo pelo balão.',
      'complex',
      { title: 'Noir', autoCloseMs: 12000 },
    );
  }

  ngOnDestroy(): void {
    this.disposeRealtime();

    if (this.sidebarCloseTimer != null) {
      window.clearTimeout(this.sidebarCloseTimer);
      this.sidebarCloseTimer = null;
    }

    if (this.refreshTimer != null) {
      window.clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }

    if (this.clockTimer != null) {
      window.clearInterval(this.clockTimer);
      this.clockTimer = null;
    }
  }

  protected openSidebar(): void {
    if (this.sidebarCloseTimer) {
      window.clearTimeout(this.sidebarCloseTimer);
      this.sidebarCloseTimer = null;
    }
    this.sidebarClosing.set(false);
    this.sidebarOpen.set(true);

    try {
      requestAnimationFrame(() => {
        const body = document.querySelector('#adminSidebar .sidebar-body') as HTMLElement | null;
        body?.scrollTo({ top: 0, left: 0 });
      });
    } catch {
      // ignore
    }
  }

  protected toggleSidebar(): void {
    if (this.sidebarShown()) this.closeSidebar();
    else this.openSidebar();
  }

  protected closeSidebar(): void {
    if (!this.sidebarOpen() && !this.sidebarClosing()) return;

    this.sidebarOpen.set(false);
    this.sidebarClosing.set(true);

    if (this.sidebarCloseTimer) window.clearTimeout(this.sidebarCloseTimer);
    this.sidebarCloseTimer = window.setTimeout(() => {
      this.sidebarClosing.set(false);
      this.sidebarCloseTimer = null;
    }, 260);
  }

  protected goBack(): void {
    void this.router.navigateByUrl('/');
    this.closeSidebar();
  }

  protected async logout(): Promise<void> {
    try {
      await this.auth.signOut();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Falha ao sair.';
      this.errorText.set(msg);
    } finally {
      this.closeSidebar();
      void this.router.navigateByUrl('/auth');
    }
  }

  protected formatDiff(seconds: number): string {
    return formatSignedTime(seconds);
  }

  protected formatTime(seconds: number): string {
    return secondsToTime(Math.abs(seconds));
  }

  protected formatLastSeen(iso: string | null): string {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleTimeString();
    } catch {
      return '—';
    }
  }

  protected formatIsoShort(iso: string): string {
    try {
      return new Date(iso).toLocaleTimeString();
    } catch {
      return iso;
    }
  }

  protected isRecentlyActive(iso: string | null): boolean {
    if (!iso) return false;
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return false;
    const msAgo = Date.now() - t;
    return msAgo >= 0 && msAgo <= 12 * 60 * 1000;
  }

  protected openUser(r: UserDayRow): void {
    this.selectedUserId.set(r.userId);
    this.detailsOpen.set(true);
  }

  protected closeDetails(): void {
    this.detailsOpen.set(false);
    this.selectedUserId.set(null);
  }

  protected setSort(key: 'units' | 'accounts' | 'saldo' | 'last'): void {
    if (this.sortKey() === key) {
      this.sortDir.set(this.sortDir() === 'asc' ? 'desc' : 'asc');
      return;
    }
    this.sortKey.set(key);
    this.sortDir.set(key === 'saldo' ? 'asc' : 'desc');
  }

  protected toggleLive(): void {
    this.liveEnabled.set(!this.liveEnabled());
    this.ensureRealtime();
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer != null) window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = null;
      void this.refresh();
    }, 650);
  }

  private disposeRealtime(): void {
    try {
      this.realtime?.unsubscribe();
    } catch {
      // ignore
    }
    this.realtime = undefined;
  }

  private ensureRealtime(): void {
    // If disabled or not configured, ensure it's off.
    if (!this.liveEnabled() || !this.sb.ready()) {
      this.disposeRealtime();
      return;
    }

    if (this.realtime) return;

    // Admin can see all rows; keep the dashboard fresh.
    this.realtime = this.sb.supabase
      .channel('admin-live')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'transactions' },
        () => this.scheduleRefresh(),
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => this.scheduleRefresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_presence' }, () => this.scheduleRefresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory' }, () => this.scheduleRefresh())
      .subscribe();
  }

  protected abs(n: number): number {
    return Math.abs(Number(n) || 0);
  }

  protected async refresh(): Promise<void> {
    if (!this.sb.ready()) {
      this.errorText.set('Supabase não configurado.');
      return;
    }

    this.loading.set(true);
    this.errorText.set('');

    try {
      const ymd = String(this.selectedDayYmd() || '').trim() || saoPauloDayKey(new Date());
      const { startIso, endIso } = saoPauloDayRangeIsoFromYmd(ymd);

      // Profiles (admin can see all)
      const { data: prof, error: profErr } = await this.sb.supabase
        .from('profiles')
        .select('user_id, username, is_admin')
        .order('username', { ascending: true });

      if (profErr) throw profErr;
      this.profiles.set(((prof as any) || []) as ProfileLite[]);

      // Today transactions (admin can see all)
      const { data: tx, error: txErr } = await this.sb.supabase
        .from('transactions')
        .select('user_id, item, type, tma, time_spent, sgss, tipo_empresa, created_at')
        .gte('created_at', startIso)
        .lt('created_at', endIso)
        .order('created_at', { ascending: false })
        .limit(5000);

      if (txErr) throw txErr;
      this.transactionsToday.set(((tx as any) || []) as TxLite[]);

      // Presence (best-effort; DB might not have the table yet)
      try {
        const { data: pres, error: presErr } = await this.sb.supabase
          .from('user_presence')
          .select('user_id, active_key, active_item, active_type, active_started_at, active_base_seconds, updated_at')
          .limit(5000);

        if (presErr) throw presErr;
        this.presence.set(((pres as any) || []) as PresenceLite[]);
      } catch {
        this.presence.set([]);
      }

      // Inventory (best-effort; DB might not have the table yet)
      try {
        const { data: inv, error: invErr } = await this.sb.supabase
          .from('inventory')
          .select('id, remaining, updated_at')
          .eq('id', 'accounts')
          .maybeSingle();

        if (invErr) throw invErr;
        const mapped = inv
          ? ({
              id: String((inv as any)?.id || '').trim() || 'accounts',
              remaining: Math.max(0, Math.floor(Number((inv as any)?.remaining) || 0)),
              updated_at: String((inv as any)?.updated_at || '').trim() || new Date().toISOString(),
            } as InventoryLite)
          : null;
        this.inventoryRow.set(mapped);

        // If admin hasn't typed anything yet, default the editor to the server value.
        if (!String(this.inventoryDraft() || '').trim() && mapped) {
          this.inventoryDraft.set(String(mapped.remaining));
        }
      } catch {
        this.inventoryRow.set(null);
      }

      this.asOfIso.set(new Date().toISOString());
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Falha ao carregar painel.';
      this.errorText.set(msg);
    } finally {
      this.loading.set(false);
      // If config changed mid-session, keep realtime in the right state.
      this.ensureRealtime();
    }
  }

  protected setSelectedDay(ymd: string): void {
    const next = String(ymd || '').trim();
    this.selectedDayYmd.set(next);
    void this.refresh();
  }

  protected setSelectedDayToday(): void {
    this.selectedDayYmd.set(localDayKey(new Date()));
    void this.refresh();
  }

  ngAfterViewChecked(): void {
    if (this.detailsOpen() && this.selectedTx().length > 0) {
      this.renderWorkHoursChart();
      this.renderWorkHoursLegend();
    }
  }

  private renderWorkHoursChart(): void {
    const tx = this.selectedTx();
    const canvas = document.getElementById('workHoursChart') as HTMLCanvasElement | null;
    if (!canvas) return;

    // Prepare data: group transactions by hour, including involuntary idle.
    const hours = new Array(24).fill(0).map(() => ({ workMinutes: 0, idleMinutes: 0 }));
    for (const t of tx) {
      const d = new Date(t.created_at);
      const h = d.getHours();
      const mins = (Number(t.time_spent) || 0) / 60;
      if (!Number.isFinite(h) || h < 0 || h > 23) continue;
      if (String(t.item).trim() === 'Ociosidade involuntaria') hours[h].idleMinutes += mins;
      else hours[h].workMinutes += mins;
    }

    drawWorkHoursByHourStacked(canvas, hours, { xLabelEvery: 3 });
  }

  private renderWorkHoursLegend(): void {
    const tx = this.selectedTx();
    const legend = document.getElementById('workHoursLegend');
    if (!legend) return;
    // Group by hour
    const hourMap: Record<number, string[]> = {};
    for (const t of tx) {
      const d = new Date(t.created_at);
      const h = d.getHours();
      if (!hourMap[h]) hourMap[h] = [];
      hourMap[h].push(`${t.item} (${this.formatTime(t.time_spent)})`);
    }
    let html = '';
    for (let h = 0; h < 24; h++) {
      if (hourMap[h] && hourMap[h].length > 0) {
        html += `<div><b>${h}:00</b>: ${hourMap[h].join(', ')}</div>`;
      }
    }
    legend.innerHTML = html || '<div>Nenhuma atividade registrada hoje.</div>';
  }
}
