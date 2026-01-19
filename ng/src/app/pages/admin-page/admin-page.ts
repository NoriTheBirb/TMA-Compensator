import { CommonModule } from '@angular/common';
import { Component, computed, OnDestroy, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import type { RealtimeChannel } from '@supabase/supabase-js';

import { AuthService } from '../../core/services/auth.service';
import { CompanionService } from '../../core/services/companion.service';
import { ProfileService } from '../../core/services/profile.service';
import { SupabaseService } from '../../core/services/supabase.service';
import { quotaWeightForItem } from '../../core/utils/assistant';
import { drawWorkHoursByHourStacked } from '../../core/utils/report';
import { formatSignedTime, secondsToTime } from '../../core/utils/time';

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
  created_at: string;
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
  protected readonly liveEnabled = signal(true);

  protected readonly detailsOpen = signal(false);
  protected readonly selectedUserId = signal<string | null>(null);

  protected readonly broadcastOpen = signal(false);
  protected readonly broadcastText = signal('');
  protected readonly broadcastSending = signal(false);
  protected readonly broadcastError = signal('');

  private readonly profiles = signal<ProfileLite[]>([]);
  private readonly transactionsToday = signal<TxLite[]>([]);

  private realtime?: RealtimeChannel;
  private refreshTimer: number | null = null;

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
    private readonly router: Router,
  ) {
    void this.refresh();
    this.ensureRealtime();
  }

  protected setCompanionEnabled(enabled: boolean): void {
    this.companion.setEnabled(Boolean(enabled));
  }

  protected openBroadcast(): void {
    this.broadcastError.set('');
    this.broadcastOpen.set(true);
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
      this.companion.speak('Mensagem enviada para todos.', 'simple', { title: 'Admin', autoCloseMs: 5000 });
    } catch (e) {
      const err = e instanceof Error ? e.message : 'Falha ao enviar mensagem.';
      this.broadcastError.set(err);
    } finally {
      this.broadcastSending.set(false);
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
      const { startIso, endIso } = dayRangeIso(new Date());

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
        .select('user_id, item, type, tma, time_spent, created_at')
        .gte('created_at', startIso)
        .lt('created_at', endIso)
        .order('created_at', { ascending: false })
        .limit(5000);

      if (txErr) throw txErr;
      this.transactionsToday.set(((tx as any) || []) as TxLite[]);

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
