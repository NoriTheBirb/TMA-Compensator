import { CommonModule } from '@angular/common';
import {
  AfterViewInit,
  Component,
  ElementRef,
  Injector,
  OnDestroy,
  ViewChild,
  computed,
  effect,
  runInInjectionContext,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';

import { AppStateService } from '../../core/state/app-state.service';
import { quotaWeightForItem } from '../../core/utils/assistant';
import { formatSignedTime } from '../../core/utils/time';
import { saoPauloDayKey } from '../../core/utils/tz';
import {
  buildAdviceHtml,
  buildBarList,
  buildPausedListHtml,
  buildRecentTxHtml,
  computeTxStats,
  drawBalanceLineChart,
  drawDiffHistogram,
  modalBodyToHtml,
  normalizePausedWorkStore,
  parseTxDate,
  secondsToTime,
  type ReportDataset,
  renderAwardsAndDaypartsHtml,
} from '../../core/utils/report';

@Component({
  selector: 'app-report-page',
  imports: [CommonModule, RouterLink],
  templateUrl: './report-page.html',
  styleUrl: './report-page.css',
})
export class ReportPage implements AfterViewInit, OnDestroy {
  @ViewChild('balanceCanvas') private readonly balanceCanvas?: ElementRef<HTMLCanvasElement>;
  @ViewChild('diffsCanvas') private readonly diffsCanvas?: ElementRef<HTMLCanvasElement>;

  private flowTickTimer: number | null = null;
  private chartRedrawTimer: number | null = null;
  private resizeHandler: (() => void) | null = null;

  protected readonly lastUpdatedAtIso = signal<string>(new Date().toISOString());

  protected readonly showLockedAchievements = signal<boolean>(false);

  protected readonly modalOpen = signal<boolean>(false);
  protected readonly modalTitle = signal<string>('Detalhes');
  protected readonly modalBodyHtml = signal<string>('<p>Sem detalhes.</p>');

  protected readonly liveDataset = signal<ReportDataset>({
    darkThemeEnabled: false,
    balanceSeconds: 0,
    transactions: [],
    lunch: null,
    shiftStartSeconds: 0,
    showComplexa: false,
    pausedWork: {},
  });

  // YYYY-MM-DD in São Paulo calendar.
  protected readonly selectedDayKey = signal<string>('');
  protected readonly isLiveDay = computed(() => {
    const selected = String(this.selectedDayKey() || '').trim();
    const active = String(this.state.activeDayKey() || '').trim();
    return Boolean(selected && active && selected === active);
  });
  protected readonly flowNowMs = signal<number>(Date.now());
  protected readonly canvasesReady = signal<boolean>(false);

  constructor(
    protected readonly state: AppStateService,
    private readonly injector: Injector,
  ) {
    // TS/JS class-field initializers run before constructor parameter properties are assigned.
    // So we must not call this.state in a field initializer.
    this.selectedDayKey.set(String(this.state.activeDayKey() || saoPauloDayKey(new Date())));
    this.liveDataset.set(this.readDatasetForDay(this.selectedDayKey()));

    effect(() => {
      // Keep the report in sync with the same in-memory state that is cloud-backed.
      const dayKey = this.selectedDayKey();
      // Touch relevant signals so this effect reacts.
      this.state.transactions();
      this.state.darkThemeEnabled();
      this.state.showComplexa();
      this.state.lunchStartSeconds();
      this.state.lunchEndSeconds();
      this.state.shiftStartSeconds();
      this.state.activeDayKey();
      this.state.pausedWork();

      this.liveDataset.set(this.readDatasetForDay(dayKey));
      this.lastUpdatedAtIso.set(new Date().toISOString());
    });
  }

  private isTxInDayKey(t: any, dayKey: string): boolean {
    const key = String(dayKey || '').trim();
    if (!key) return false;

    const txDayKey = String((t as any)?.dayKey || '').trim();
    if (txDayKey) return txDayKey === key;

    const raw = String((t as any)?.createdAtIso || (t as any)?.timestamp || '').trim();
    const dt = parseTxDate(raw);
    if (!dt) return false;
    return saoPauloDayKey(dt) === key;
  }

  private readDatasetForDay(dayKey: string): ReportDataset {
    const lunchStart = this.state.lunchStartSeconds();
    const lunchEnd = this.state.lunchEndSeconds();

    // Report can show today or historical days.
    // Always ignore Time Tracker entries for all report charts/KPIs.
    const all = (this.state.transactions() as any[]) || [];
    const key = String(dayKey || '').trim();
    const transactions = (Array.isArray(all) ? all : [])
      .filter((t) => this.isTxInDayKey(t, key))
      .filter((t) => String((t as any)?.type || '').trim().toLowerCase() !== 'time_tracker');

    const balanceSeconds = transactions.reduce((acc, t) => acc + (Number((t as any)?.difference) || 0), 0);

    return {
      darkThemeEnabled: this.state.darkThemeEnabled(),
      balanceSeconds,
      transactions,
      lunch: lunchStart !== null && lunchEnd !== null ? { start: lunchStart, end: lunchEnd } : null,
      shiftStartSeconds: this.state.shiftStartSeconds(),
      showComplexa: this.state.showComplexa(),
      pausedWork: this.isLiveDay() ? this.state.pausedWork() : {},
    };
  }

  protected readonly dataset = computed<ReportDataset>(() => this.liveDataset());

  protected readonly datasetHintHtml = computed(() => {
    const updatedAt = new Date(this.lastUpdatedAtIso()).toLocaleTimeString();
    const key = String(this.selectedDayKey() || '').trim();
    const todayKey = String(this.state.activeDayKey() || '').trim();
    const isToday = Boolean(key && todayKey && key === todayKey);
    return `
      <span class="report-pill ${isToday ? 'good' : ''}">${isToday ? 'Ao vivo' : 'Histórico'}</span>
      <span style="margin-left:8px;">Dia: <b>${key || '—'}</b></span>
      <span class="report-muted" style="margin-left:8px;">${isToday ? `Atualizado: ${updatedAt}` : 'Fechado (sem atualização ao vivo)'}</span>
    `;
  });

  protected setReportDayKey(raw: string): void {
    const next = String(raw || '').trim();
    if (!next) return;
    this.selectedDayKey.set(next);
  }

  protected setToday(): void {
    this.setReportDayKey(String(this.state.activeDayKey() || saoPauloDayKey(new Date())));
  }

  protected setYesterday(): void {
    const ms = Date.now() - 24 * 60 * 60 * 1000;
    this.setReportDayKey(saoPauloDayKey(new Date(ms)));
  }

  protected readonly balanceText = computed(() => formatSignedTime(this.dataset().balanceSeconds));
  protected readonly txStats = computed(() => computeTxStats(this.dataset().transactions));
  protected readonly avgDiffText = computed(() => formatSignedTime(this.txStats().avgDiff));
  protected readonly timeSpentText = computed(() => secondsToTime(this.txStats().sumTimeSpent));

  protected readonly pausedStats = computed(() => {
    const normalized = normalizePausedWorkStore(this.dataset().pausedWork);
    const entries = Object.values(normalized).flat();
    const count = entries.length;
    const total = entries.reduce((a: number, e: any) => a + (Number(e?.accumulatedSeconds) || 0), 0);
    return { count, totalSeconds: total };
  });

  protected readonly pausedTotalText = computed(() => secondsToTime(this.pausedStats().totalSeconds));

  protected readonly quotaDoneUnits = computed(() => {
    let units = 0;
    for (const t of this.dataset().transactions || []) {
      units += quotaWeightForItem(String((t as any)?.item || ''));
    }
    return units;
  });
  protected readonly quotaRemainingUnits = computed(() => Math.max(0, 17 - this.quotaDoneUnits()));

  protected readonly configThemeText = computed(() => (this.dataset().darkThemeEnabled ? 'Escuro' : 'Claro'));
  protected readonly configComplexaText = computed(() => (this.dataset().showComplexa ? 'Sim' : 'Não'));
  protected readonly configShiftText = computed(() => (this.dataset().shiftStartSeconds ? clockTextFromSeconds(this.dataset().shiftStartSeconds) : '—'));
  protected readonly configLunchText = computed(() => {
    const lunch = this.dataset().lunch;
    if (!lunch) return '—';
    return `${clockTextFromSeconds(lunch.start)} → ${clockTextFromSeconds(lunch.end)}`;
  });

  protected readonly topItemsHtml = computed(() => buildBarList('Top itens', this.txStats().topItems));

  protected readonly recentTxHtml = computed(() => buildRecentTxHtml(this.dataset().transactions));
  protected readonly pausedListHtml = computed(() => buildPausedListHtml(this.dataset().pausedWork));

  protected readonly advice = computed(() => buildAdviceHtml(this.dataset().transactions, this.dataset().balanceSeconds));
  protected readonly suggestionsHtml = computed(() => this.advice().suggestionsHtml);
  protected readonly funHtml = computed(() => this.advice().funHtml);

  protected readonly awardsAndDayparts = computed(() =>
    renderAwardsAndDaypartsHtml({
      transactions: this.dataset().transactions,
      balanceSeconds: this.dataset().balanceSeconds,
      lunchWindow: this.dataset().lunch,
      showLocked: this.showLockedAchievements(),
    }),
  );
  protected readonly awardsHtml = computed(() => this.awardsAndDayparts().awardsHtml);
  protected readonly daypartsHtml = computed(() => this.awardsAndDayparts().daypartsHtml);

  protected readonly flowTimerText = computed(() => {
    const t = this.state.activeFlowTimer();
    if (!t) return '--:--:--';
    const elapsed = Math.floor((this.flowNowMs() - Number(t.start)) / 1000);
    const total = Math.max(0, Math.floor(Number(t.baseSeconds) || 0) + Math.max(0, elapsed));
    return secondsToTime(total);
  });

  protected readonly flowTimerMetaText = computed(() => {
    const t = this.state.activeFlowTimer();
    if (!t) return 'Nenhum timer em andamento.';
    const label = `${String(t.item || '').trim()} • ${String(t.type || '').trim()}`.trim();
    const tma = Number(t.tma) || 0;
    return label ? `${label} • TMA: ${secondsToTime(tma)}` : `TMA: ${secondsToTime(tma)}`;
  });

  ngAfterViewInit(): void {
    this.canvasesReady.set(true);

    const renderCharts = () => {
      if (!this.canvasesReady()) return;
      const balanceEl = this.balanceCanvas?.nativeElement;
      const diffsEl = this.diffsCanvas?.nativeElement;
      if (balanceEl) drawBalanceLineChart(balanceEl, (this.dataset().transactions || []).slice().reverse());
      if (diffsEl) drawDiffHistogram(diffsEl, this.advice().diffsNewestFirst);
    };

    // Initial
    renderCharts();

    // Reactive re-draw when dataset changes.
    // effect() must run inside an injection context.
    runInInjectionContext(this.injector, () => {
      effect(() => {
        if (!this.canvasesReady()) return;
        this.dataset();
        this.advice();
        this.showLockedAchievements();
        queueMicrotask(() => renderCharts());
      });
    });

    this.resizeHandler = () => renderCharts();
    window.addEventListener('resize', this.resizeHandler);

    // Flow timer card tick
    this.flowNowMs.set(Date.now());
    this.flowTickTimer = window.setInterval(() => {
      if (document.hidden) return;
      this.flowNowMs.set(Date.now());
    }, 1000);

    // Periodic redraw for the time-based chart axis.
    this.chartRedrawTimer = window.setInterval(() => {
      if (document.hidden) return;
      renderCharts();
    }, 2000);
  }

  ngOnDestroy(): void {
    if (this.flowTickTimer) window.clearInterval(this.flowTickTimer);
    if (this.chartRedrawTimer) window.clearInterval(this.chartRedrawTimer);

    if (this.resizeHandler) window.removeEventListener('resize', this.resizeHandler);
  }

  protected onAwardsClick(ev: MouseEvent): void {
    const rawTarget: any = ev.target as any;
    const target = (rawTarget && rawTarget.nodeType === 3) ? rawTarget.parentElement : rawTarget;
    const btn = (target as HTMLElement | null)?.closest?.('[data-awards-toggle]') as HTMLElement | null;
    if (btn) {
      ev.preventDefault();
      ev.stopPropagation();
      this.showLockedAchievements.update(v => !v);
      return;
    }

    const clickable = target?.closest?.('[data-modal-title][data-modal-body]') as HTMLElement | null;
    if (clickable) {
      this.openModalFromEl(clickable);
    }
  }

  protected onExplainableClick(ev: MouseEvent): void {
    const rawTarget: any = ev.target as any;
    const target = (rawTarget && rawTarget.nodeType === 3) ? rawTarget.parentElement : rawTarget;
    const clickable = (target as HTMLElement | null)?.closest?.('[data-modal-title][data-modal-body]') as HTMLElement | null;
    if (!clickable) return;
    ev.preventDefault();
    this.openModalFromEl(clickable);
  }

  private openModalFromEl(el: HTMLElement): void {
    const title = el.getAttribute('data-modal-title') || 'Detalhes';
    const bodyEncoded = el.getAttribute('data-modal-body') || '';
    let body = '';
    try {
      body = decodeURIComponent(bodyEncoded);
    } catch {
      body = bodyEncoded;
    }
    this.modalTitle.set(title);
    this.modalBodyHtml.set(modalBodyToHtml(body));
    this.modalOpen.set(true);
  }

  protected closeModal(): void {
    this.modalOpen.set(false);
  }

  protected toggleTheme(): void {
    this.state.setDarkThemeEnabled(!document.body.classList.contains('dark-theme'));
  }
}

function clockTextFromSeconds(seconds: number): string {
  const sec = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(sec / 3600) % 24;
  const minutes = Math.floor((sec % 3600) / 60);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}
