import { Injectable, Injector, computed, effect, signal } from '@angular/core';

import type { LegacyTransaction } from '../models/transaction';
import type { ActiveFlowTimerPersisted, PausedWorkEntry, PausedWorkStore } from '../models/paused-work';
import type { AnalyticsState } from '../models/analytics';
import { DEFAULT_ACCOUNT_CATALOG } from '../config/account-catalog';
import { StorageService } from '../storage/storage.service';
import {
  durationToHHMM,
  formatSignedTime,
  parseClockHHMMSSToSeconds,
  parseClockHHMMToSeconds,
  secondsToClockHHMM,
  secondsToHuman,
  secondsToTime,
} from '../utils/time';
import { quotaWeightForItem } from '../utils/assistant';
import { CloudSyncService } from '../services/cloud-sync.service';

export const BALANCE_MARGIN_SECONDS = 600;

export const SHIFT_TOTAL_SECONDS = 9 * 3600 + 48 * 60; // 09:48
export const DEFAULT_SHIFT_START_SECONDS = 8 * 3600; // 08:00
export const DAILY_QUOTA = 17;

const TIME_TRACKER_TYPE = 'time_tracker';
const TIME_TRACKER_INVOLUNTARY_IDLE_ITEM = 'Ociosidade involuntaria';
const TIME_TRACKER_ITEMS = [
  'Pausa',
  'Almoço',
  'Falha sistemica',
  'Ociosidade',
  'Processo interno',
  'Daily',
  // Not shown as a button/tab option: used for auto-detected idle gaps.
  TIME_TRACKER_INVOLUNTARY_IDLE_ITEM,
];

@Injectable({ providedIn: 'root' })
export class AppStateService {
  // Time Tracker: if no activity is registered for 4 minutes, auto-start an "Ociosidade involuntaria" timer.
  // It runs until the user records any other action/transaction.
  readonly timeTrackerModeEnabled = signal<boolean>(false);
  private inactivityTickerId: number | null = null;
  private lastRegisteredAtMs: number = Date.now();
  private lastInvoluntaryIdleWarnAtMs: number = 0;
  private readonly involuntaryIdleKey = this.actionKey(TIME_TRACKER_INVOLUNTARY_IDLE_ITEM, TIME_TRACKER_TYPE);

  private readonly validFlowKeys = new Set([
    ...DEFAULT_ACCOUNT_CATALOG.flatMap(g => (g.actions || []).map(a => this.actionKey((a as any).item, (a as any).type))),
    ...TIME_TRACKER_ITEMS.map(item => this.actionKey(item, TIME_TRACKER_TYPE)),
  ]);
  readonly balanceSeconds = signal<number>(0);
  readonly transactions = signal<LegacyTransaction[]>([]);

  readonly darkThemeEnabled = signal<boolean>(false);
  readonly showComplexa = signal<boolean>(false);
  readonly shiftStartSeconds = signal<number>(DEFAULT_SHIFT_START_SECONDS);
  readonly lunchStartSeconds = signal<number | null>(null);
  readonly lunchEndSeconds = signal<number | null>(null);
  readonly nowSeconds = signal<number>(0);
  readonly flowModeEnabled = signal<boolean>(false);
  readonly analytics = signal<AnalyticsState | null>(null);

  readonly lunchStyleEnabled = signal<boolean>(true);

  readonly debugTimeSeconds = signal<number | null>(null);
  readonly simRunning = signal<boolean>(false);
  readonly simSpeed = signal<number>(60);
  readonly simStatus = signal<string>('Stopped');

  readonly pausedWork = signal<PausedWorkStore>({});
  readonly activeFlowTimer = signal<ActiveFlowTimerPersisted | null>(null);
  readonly flowNowMs = signal<number>(Date.now());

  readonly withinBalanceMargin = computed(() => Math.abs(this.balanceSeconds()) <= BALANCE_MARGIN_SECONDS);
  readonly shiftEndSeconds = computed(() => this.shiftStartSeconds() + SHIFT_TOTAL_SECONDS);
  readonly shiftClockRange = computed(
    () => `${secondsToClockHHMM(this.shiftStartSeconds())} - ${secondsToClockHHMM(this.shiftEndSeconds())}`,
  );
  readonly lunchClockRange = computed(() => {
    const s = this.lunchStartSeconds();
    const e = this.lunchEndSeconds();
    if (s === null || e === null) return 'Não configurado';
    return `${secondsToClockHHMM(s)} - ${secondsToClockHHMM(e)}`;
  });

  readonly isLunchNow = computed(() => {
    const s = this.lunchStartSeconds();
    const e = this.lunchEndSeconds();
    const now = this.nowSeconds();
    return s !== null && e !== null && now >= s && now < e;
  });

  readonly manualLunchActive = computed(() => {
    const t = this.activeFlowTimer();
    return Boolean(t && String(t.item || '') === 'Almoço' && String(t.type || '') === TIME_TRACKER_TYPE);
  });

  readonly lunchModeEnabled = computed(() => Boolean((this.lunchStyleEnabled() && this.isLunchNow()) || this.manualLunchActive()));

  readonly statusLabel = computed(() => {
    const now = this.nowSeconds();
    const start = this.shiftStartSeconds();
    const end = this.shiftEndSeconds();
    if (now < start) return 'Antes do turno';
    if (now >= end) return 'Turno encerrado';
    if (this.lunchModeEnabled()) return 'Em almoço';
    return 'Trabalhando';
  });

  readonly turnoNowClock = computed(() => secondsToClockHHMM(this.nowSeconds()));
  readonly turnoEndClock = computed(() => secondsToClockHHMM(this.shiftEndSeconds()));

  readonly remainingShiftSeconds = computed(() => {
    const now = this.nowSeconds();
    const end = this.shiftEndSeconds();
    return Math.max(0, end - now);
  });

  readonly turnoAtualHHMM = computed(() => durationToHHMM(this.remainingShiftSeconds()));

  readonly totalWorkSeconds = computed(() => {
    const lunch = this.getLunchWindowWithinShift();
    const lunchDur = lunch ? Math.max(0, lunch.end - lunch.start) : 0;
    return Math.max(0, SHIFT_TOTAL_SECONDS - lunchDur);
  });

  readonly remainingWorkSeconds = computed(() => this.computeRemainingWorkSeconds());
  readonly elapsedWorkSeconds = computed(() => Math.max(0, this.totalWorkSeconds() - this.remainingWorkSeconds()));
  readonly turnoWorkLeftHuman = computed(() => secondsToHuman(this.remainingWorkSeconds()));

  readonly quotaUnitsDone = computed(() => {
    const list = this.transactions() || [];
    let units = 0;
    for (const t of list) {
      const item = String((t as any)?.item || '');
      units += quotaWeightForItem(item);
    }
    return units;
  });
  readonly quotaUnitsRemaining = computed(() => Math.max(0, DAILY_QUOTA - this.quotaUnitsDone()));

  readonly assistantKpis = computed(() => {
    const tx = this.transactions() || [];
    const doneTx = tx.length;

    const doneUnits = this.quotaUnitsDone();
    const remainingUnits = this.quotaUnitsRemaining();

    const totalWorkSeconds = this.totalWorkSeconds();
    const elapsedWorkSeconds = this.elapsedWorkSeconds();
    const remainingWorkSeconds = this.remainingWorkSeconds();

    const now = this.nowSeconds();
    const shiftStart = this.shiftStartSeconds();
    const shiftEnd = this.shiftEndSeconds();
    const dayPart = this.getWorkDayPart(now, { shiftStart, shiftEnd, elapsedWorkSeconds, totalWorkSeconds });

    const expectedDoneNow =
      totalWorkSeconds > 0 ? Math.min(DAILY_QUOTA, Math.floor((elapsedWorkSeconds / totalWorkSeconds) * DAILY_QUOTA)) : 0;
    const quotaDelta = doneUnits - expectedDoneNow;

    const hoursLeft = remainingWorkSeconds / 3600;
    const pacePerHourNeeded = hoursLeft > 0 ? remainingUnits / hoursLeft : Infinity;

    const budgetPerAccountSeconds = remainingUnits > 0 && remainingWorkSeconds > 0 ? remainingWorkSeconds / remainingUnits : 0;

    const currentPacePerHour = elapsedWorkSeconds > 0 ? doneUnits / (elapsedWorkSeconds / 3600) : 0;
    const projectedEndCount =
      elapsedWorkSeconds > 0 && totalWorkSeconds > 0 ? Math.round((doneUnits / elapsedWorkSeconds) * totalWorkSeconds) : doneUnits;

    const avgDiffTarget = remainingUnits > 0 ? (-this.balanceSeconds()) / remainingUnits : 0;
    const avgDiffMin = remainingUnits > 0 ? (-BALANCE_MARGIN_SECONDS - this.balanceSeconds()) / remainingUnits : 0;
    const avgDiffMax = remainingUnits > 0 ? (BALANCE_MARGIN_SECONDS - this.balanceSeconds()) / remainingUnits : 0;

    const diffs = tx.map(t => Number((t as any)?.difference)).filter(n => Number.isFinite(n));
    const sumDiffSoFar = diffs.length ? diffs.reduce((a, b) => a + b, 0) : 0;
    const avgDiffSoFar = doneUnits > 0 ? sumDiffSoFar / doneUnits : 0;
    const predictedEnd = sumDiffSoFar + avgDiffSoFar * remainingUnits;
    const predictedOk = Math.abs(predictedEnd) <= BALANCE_MARGIN_SECONDS;

    const timeSpentSeconds = tx
      .map(t => Number((t as any)?.timeSpent))
      .filter(n => Number.isFinite(n) && n >= 0);
    const totalTimeSpentSeconds = timeSpentSeconds.length ? timeSpentSeconds.reduce((a, b) => a + b, 0) : 0;
    const avgTimeSpentSeconds = doneUnits > 0 ? totalTimeSpentSeconds / doneUnits : 0;

    const targetLabel = avgDiffTarget < 0 ? 'mais rápido' : 'mais devagar';

    return {
      dailyQuota: DAILY_QUOTA,
      dayPart,
      doneTx,
      doneUnits,
      remainingUnits,
      expectedDoneNow,
      quotaDelta,
      pacePerHourNeeded,
      pacePerHourNeededText: Number.isFinite(pacePerHourNeeded) ? `${pacePerHourNeeded.toFixed(1)} contas/h` : '∞ contas/h',
      budgetPerAccountSeconds,
      avgTimeSpentSeconds,
      currentPacePerHour,
      currentPacePerHourText: `${(Number.isFinite(currentPacePerHour) ? currentPacePerHour : 0).toFixed(1)} contas/h`,
      projectedEndCount: Math.min(projectedEndCount, DAILY_QUOTA),
      avgDiffMin,
      avgDiffMax,
      avgDiffSoFar,
      predictedEnd,
      predictedOk,
      targetLabel,
      avgDiffTarget,
      balanceText: formatSignedTime(this.balanceSeconds()),
      remainingWorkText: secondsToHuman(remainingWorkSeconds),
      withinMarginNow: this.withinBalanceMargin(),
    };
  });

  private getWorkDayPart(
    currentSeconds: number,
    input?: { shiftStart?: number; shiftEnd?: number; elapsedWorkSeconds?: number; totalWorkSeconds?: number },
  ): { key: string; label: string; note: string } {
    const now = Number(currentSeconds);
    if (!Number.isFinite(now)) return { key: 'unknown', label: 'Agora', note: '' };

    const shiftStart = Number(input?.shiftStart);
    const shiftEnd = Number(input?.shiftEnd);
    const elapsedWorkSeconds = Number(input?.elapsedWorkSeconds);
    const totalWorkSeconds = Number(input?.totalWorkSeconds);

    if (Number.isFinite(shiftStart) && now < shiftStart) {
      return {
        key: 'pre',
        label: 'Pré-turno',
        note: 'Aquece sem pressa: começa pelo simples e mantém o saldo perto de 00:00:00.',
      };
    }

    if (Number.isFinite(shiftEnd) && now > shiftEnd) {
      return { key: 'post', label: 'Pós-turno', note: '' };
    }

    const lunchStart = this.lunchStartSeconds();
    const lunchEnd = this.lunchEndSeconds();
    if (lunchStart !== null && lunchEnd !== null && now >= lunchStart && now <= lunchEnd) {
      return { key: 'lunch', label: 'Almoço', note: 'Almoço não conta como produção. Sem culpa: volta no ritmo depois.' };
    }

    const ratio = Number.isFinite(elapsedWorkSeconds) && Number.isFinite(totalWorkSeconds) && totalWorkSeconds > 0 ? elapsedWorkSeconds / totalWorkSeconds : 0;
    if (ratio < 0.33) {
      return {
        key: 'early',
        label: 'Começo do turno',
        note: 'Pega ritmo no básico: prioriza Conferência. Retorno é raro, então não conta com ele.',
      };
    }
    if (ratio < 0.66) {
      return {
        key: 'mid',
        label: 'Meio do turno',
        note: 'Segue no consistente: Conferência como padrão e saldo como “régua” (bem = perto de 00:00:00).',
      };
    }
    return {
      key: 'late',
      label: 'Final do turno',
      note: 'Sem inventar: prioriza o que você tem histórico e fecha a meta com consistência.',
    };
  }

  readonly activeFlowKey = computed(() => this.activeFlowTimer()?.key ?? null);
  readonly activeFlowTotalSeconds = computed(() => {
    const t = this.activeFlowTimer();
    if (!t) return 0;
    const elapsed = Math.floor((this.flowNowMs() - Number(t.start)) / 1000);
    return Math.max(0, Math.floor(Number(t.baseSeconds) || 0) + Math.max(0, elapsed));
  });

  readonly pausedEntriesSorted = computed(() => {
    const normalized = this.normalizePausedWorkStore(this.pausedWork());
    const out: Array<{
      key: string;
      entryId: string;
      item: string;
      type: string;
      tma: number;
      accumulatedSeconds: number;
      updatedAtIso: string;
    }> = [];
    for (const [key, entries] of Object.entries(normalized || {})) {
      const list = Array.isArray(entries) ? entries : [];
      for (const e of list) {
        out.push({
          key,
          entryId: String((e as any)?.id || ''),
          item: String((e as any)?.item || ''),
          type: String((e as any)?.type || ''),
          tma: Number((e as any)?.tma) || 0,
          accumulatedSeconds: Math.max(0, Math.floor(Number((e as any)?.accumulatedSeconds) || 0)),
          updatedAtIso: String((e as any)?.updatedAtIso || ''),
        });
      }
    }
    return out
      .filter(p => p.key && p.entryId && p.item && p.type && p.accumulatedSeconds > 0)
      .sort((a, b) => String(b.updatedAtIso).localeCompare(String(a.updatedAtIso)));
  });

  readonly needsOnboarding = signal<boolean>(false);
  readonly onboardingOpen = signal<boolean>(false);

  constructor(
    private readonly storage: StorageService,
    private readonly injector: Injector,
  ) {
    this.reloadFromStorage();
    this.startClock();
  }

  private get cloud(): CloudSyncService | null {
    try {
      return this.injector.get(CloudSyncService);
    } catch {
      return null;
    }
  }

  private cloudEnabled(): boolean {
    return Boolean(this.cloud && !this.cloud.isApplyingRemote());
  }

  reloadFromStorage(): void {
    this.balanceSeconds.set(this.storage.getBalanceSeconds());
    const tx = this.storage.getTransactions();
    this.transactions.set(tx);
    this.syncLastRegisteredFromTransactions(tx);

    this.darkThemeEnabled.set(this.storage.getDarkThemeEnabled());
    this.showComplexa.set(this.storage.getShowComplexa());
    this.flowModeEnabled.set(this.storage.getFlowModeEnabled());
    this.lunchStyleEnabled.set(this.storage.getLunchStyleEnabled());
    this.loadOrInitAnalytics();

    this.pausedWork.set(this.storage.getPausedWorkStore());

    const shiftStartOrNull = this.storage.getShiftStartSecondsOrNull();
    this.shiftStartSeconds.set(this.normalizeShiftStartSeconds(shiftStartOrNull ?? DEFAULT_SHIFT_START_SECONDS));

    const lunch = this.storage.getLunchWindowOrNull();
    this.lunchStartSeconds.set(lunch?.start ?? null);
    this.lunchEndSeconds.set(lunch?.end ?? null);

    // Legacy: onboarding shows if either lunch OR shiftStart is missing.
    this.needsOnboarding.set(!lunch || shiftStartOrNull === null);
    this.onboardingOpen.set(this.needsOnboarding());

    const restored = this.storage.getActiveFlowTimerOrNull();
    if (restored) {
      // Legacy behavior: restoring a timer forces Flow on, but only if it maps to an existing button.
      const keyFromPayload = this.actionKey(restored.item, restored.type);
      const key = String(restored.key || '');
      const looksValid = Boolean(this.validFlowKeys.has(keyFromPayload) && (!key || key === keyFromPayload));

      if (looksValid) {
        this.activeFlowTimer.set({ ...restored, key: keyFromPayload });
        this.flowModeEnabled.set(true);
        this.storage.setFlowModeEnabled(true);
        this.startFlowTickerIfNeeded();
      } else {
        // Clear stale persisted data so Flow isn't forced on forever.
        this.storage.clearActiveFlowTimer();
      }
    }

    this.applyBodyClasses();
  }

  setTimeTrackerModeEnabled(enabled: boolean): void {
    const next = Boolean(enabled);
    this.timeTrackerModeEnabled.set(next);
    if (next) this.startInactivityTickerIfNeeded();
    else this.stopInactivityTicker();

    // If the user leaves TT mode while the auto-idle timer is active, finalize it.
    const t = this.activeFlowTimer();
    if (!next && t && String(t.key || '') === this.involuntaryIdleKey) {
      this.stopFlowTimerForKey(this.involuntaryIdleKey, true);
    }
  }

  private startInactivityTickerIfNeeded(): void {
    if (this.inactivityTickerId !== null) return;
    this.inactivityTickerId = window.setInterval(() => this.tickInvoluntaryIdle(), 5000);
  }

  private stopInactivityTicker(): void {
    if (this.inactivityTickerId === null) return;
    try {
      window.clearInterval(this.inactivityTickerId);
    } catch {
      // ignore
    }
    this.inactivityTickerId = null;
  }

  private syncLastRegisteredFromTransactions(list: LegacyTransaction[] | null | undefined): void {
    const tx = Array.isArray(list) ? list : [];
    let best = 0;
    for (const t of tx) {
      const iso = String((t as any)?.createdAtIso || '').trim();
      if (!iso) continue;
      const ms = Date.parse(iso);
      if (Number.isFinite(ms) && ms > best) best = ms;
    }
    if (best > 0) this.lastRegisteredAtMs = best;
  }

  private touchRegisteredNow(): void {
    this.lastRegisteredAtMs = Date.now();
  }

  private ensureInvoluntaryIdleStopped(): void {
    const t = this.activeFlowTimer();
    if (!t) return;
    if (String(t.key || '') !== this.involuntaryIdleKey) return;
    this.stopFlowTimerForKey(this.involuntaryIdleKey, true);
  }

  private tickInvoluntaryIdle(): void {
    if (!this.timeTrackerModeEnabled()) return;
    if (this.onboardingOpen()) return;

    // Only track during the configured shift window.
    const now = this.nowSeconds();
    if (now < this.shiftStartSeconds()) return;
    if (now >= this.shiftEndSeconds()) return;

    const active = this.activeFlowTimer();
    if (active) return; // Any active timer means the user is "in something" already.

    const msSince = Date.now() - Number(this.lastRegisteredAtMs || 0);
    if (!Number.isFinite(msSince) || msSince < 0) return;

    const startAtMs = 4 * 60 * 1000;
    const warnAtMs = 3.5 * 60 * 1000;

    // Companion warning: 30s before auto-idle. Throttle to avoid spam.
    if (msSince >= warnAtMs && msSince < startAtMs) {
      const nowMs = Date.now();
      if (nowMs - this.lastInvoluntaryIdleWarnAtMs > 60_000) {
        this.lastInvoluntaryIdleWarnAtMs = nowMs;
        const remainingSec = Math.max(0, Math.ceil((startAtMs - msSince) / 1000));
        try {
          window.dispatchEvent(new CustomEvent('tt_idle_warning', { detail: { remainingSec } }));
        } catch {
          // ignore
        }
      }
    }

    if (msSince < startAtMs) return;

    // Start auto-idle without counting as user activity.
    this.startFlowTimer({
      item: TIME_TRACKER_INVOLUNTARY_IDLE_ITEM,
      type: TIME_TRACKER_TYPE,
      tmaSeconds: 0,
      baseSeconds: 0,
      key: this.involuntaryIdleKey,
      markActivity: false,
    });
    this.logEvent('tt_involuntary_idle_started', { timeoutMs: startAtMs });
  }

  openOnboarding(): void {
    this.onboardingOpen.set(true);
    this.applyBodyClasses();
  }

  closeOnboarding(): void {
    // If first-run onboarding is required, keep it locked open.
    if (this.needsOnboarding()) return;
    this.onboardingOpen.set(false);
    this.applyBodyClasses();
  }

  setDarkThemeEnabled(enabled: boolean): void {
    this.darkThemeEnabled.set(Boolean(enabled));
    this.storage.setDarkThemeEnabled(Boolean(enabled));
    this.applyBodyClasses();

    if (this.cloudEnabled()) {
      void this.cloud!.upsertSettingsFromState(this.exportSettingsForCloud());
    }
  }

  setShowComplexa(enabled: boolean): void {
    this.showComplexa.set(Boolean(enabled));
    this.storage.setShowComplexa(Boolean(enabled));

    if (this.cloudEnabled()) {
      void this.cloud!.upsertSettingsFromState(this.exportSettingsForCloud());
    }
  }

  setFlowModeEnabled(enabled: boolean): void {
    const next = Boolean(enabled);
    if (!next && this.activeFlowTimer()) {
      // Legacy: cannot disable flow while a timer is active.
      return;
    }
    this.flowModeEnabled.set(next);
    this.storage.setFlowModeEnabled(next);
    if (next) this.bumpFlowCounter('modeEnabledCount');
    else this.bumpFlowCounter('modeDisabledCount');
    this.logEvent('flow_mode_set', { enabled: next });
    this.applyBodyClasses();
  }

  setLunchStyleEnabled(enabled: boolean): void {
    const next = Boolean(enabled);
    this.lunchStyleEnabled.set(next);
    this.storage.setLunchStyleEnabled(next);
    this.logEvent('lunch_style_enabled_set', { enabled: Boolean(enabled) });
    this.applyBodyClasses();

    if (this.cloudEnabled()) {
      void this.cloud!.upsertSettingsFromState(this.exportSettingsForCloud());
    }
  }

  setDebugTimeFromInput(raw: string): void {
    const parsed = parseClockHHMMSSToSeconds(String(raw || ''));
    if (parsed === null) throw new Error('Formato inválido. Use HH:MM:SS ou HH:MM');
    this.debugTimeSeconds.set(parsed);
    this.simRunning.set(false);
    this.simStatus.set('Paused');
    this.bumpDebugCounter('setDebugTimeCount');
    this.logEvent('debug_time_set', { debugTimeSeconds: parsed });
    this.syncNowSeconds();
  }

  resetDebugTime(): void {
    this.debugTimeSeconds.set(null);
    this.simRunning.set(false);
    this.simStatus.set('Stopped');
    this.bumpDebugCounter('resetDebugTimeCount');
    this.logEvent('debug_time_reset', {});
    this.syncNowSeconds();
  }

  setSimSpeed(speed: number): void {
    const v = Number(speed);
    this.simSpeed.set(Number.isFinite(v) && v > 0 ? v : 60);
  }

  startOrResumeSim(): void {
    this.simRunning.set(true);
    this.simStatus.set('Running');
    this.bumpDebugCounter('simStartCount');
    this.logEvent('debug_sim_start', { speed: this.simSpeed() });
    this.startSimTickerIfNeeded();
  }

  pauseSim(): void {
    this.simRunning.set(false);
    this.simStatus.set('Paused');
    this.bumpDebugCounter('simPauseCount');
    this.logEvent('debug_sim_pause', {});
    this.stopSimTicker();
  }

  stopAndResetSim(): void {
    this.simRunning.set(false);
    this.simStatus.set('Stopped');
    this.bumpDebugCounter('simResetCount');
    this.logEvent('debug_sim_reset', {});
    this.stopSimTicker();
    this.debugTimeSeconds.set(null);
    this.syncNowSeconds();
  }

  actionKey(item: string, type: string): string {
    return `${String(item || '')}-${String(type || '')}`;
  }

  timerTextForAccount(accountItem: string): string {
    const t = this.activeFlowTimer();
    if (!t) return '00:00:00';
    return String(t.item || '') === String(accountItem || '') ? secondsToTime(this.activeFlowTotalSeconds()) : '00:00:00';
  }

  isFlowActionDisabled(key: string): boolean {
    if (!this.flowModeEnabled()) return false;
    const activeKey = this.activeFlowKey();
    return Boolean(activeKey && key !== activeKey);
  }

  getPausedEntryById(key: string, entryId: string): PausedWorkEntry | null {
    if (!key || !entryId) return null;
    const entries = this.getPausedEntriesForKey(key);
    return entries.find(e => String(e?.id || '') === String(entryId)) || null;
  }

  getLatestPausedEntry(key: string): PausedWorkEntry | null {
    const entries = this.getPausedEntriesForKey(key);
    return entries.length ? entries[entries.length - 1] : null;
  }

  getPausedCountForKey(key: string): number {
    return this.getPausedEntriesForKey(key).length;
  }

  getPausedSecondsForKey(key: string): number {
    const latest = this.getLatestPausedEntry(key);
    const s = Number(latest?.accumulatedSeconds);
    return Number.isFinite(s) ? Math.max(0, Math.floor(s)) : 0;
  }

  removePausedEntry(key: string, entryId: string | null): void {
    if (!key) return;
    const normalized = this.normalizePausedWorkStore(this.pausedWork());
    const entries = this.getPausedEntriesForKey(key, normalized);
    if (!entries.length) return;
    const next = entryId
      ? entries.filter(e => String(e?.id || '') !== String(entryId))
      : entries.slice(0, -1);
    if (next.length) normalized[key] = next;
    else delete normalized[key];
    this.pausedWork.set(normalized);
    this.storage.setPausedWorkStore(normalized);
  }

  updatePausedEntry(key: string, entryId: string, patch: Partial<PausedWorkEntry>): boolean {
    if (!key || !entryId) return false;
    const normalized = this.normalizePausedWorkStore(this.pausedWork());
    const entries = this.getPausedEntriesForKey(key, normalized);
    const idx = entries.findIndex(e => String(e?.id || '') === String(entryId));
    if (idx < 0) return false;
    const prev = entries[idx] || ({} as PausedWorkEntry);
    entries[idx] = {
      ...prev,
      ...patch,
      id: String(prev.id || entryId),
      updatedAtIso: String((patch as any)?.updatedAtIso || new Date().toISOString()),
    };
    normalized[key] = entries;
    this.pausedWork.set(normalized);
    this.storage.setPausedWorkStore(normalized);
    return true;
  }

  setPausedWork(key: string, input: { item: string; type: string; tma: number; accumulatedSeconds: number }): string | null {
    if (!key) return null;
    const secs = Math.max(0, Math.floor(Number(input?.accumulatedSeconds) || 0));
    const normalized = this.normalizePausedWorkStore(this.pausedWork());
    const entry: PausedWorkEntry = {
      id: this.makePausedEntryId(),
      item: String(input?.item || ''),
      type: String(input?.type || ''),
      tma: Number(input?.tma) || 0,
      accumulatedSeconds: secs,
      updatedAtIso: new Date().toISOString(),
    };
    if (!entry.item || !entry.type || entry.accumulatedSeconds <= 0) return null;
    if (!normalized[key]) normalized[key] = [];
    normalized[key].push(entry);
    this.pausedWork.set(normalized);
    this.storage.setPausedWorkStore(normalized);
    return entry.id;
  }

  startFlowTimer(input: {
    item: string;
    type: string;
    tmaSeconds: number;
    baseSeconds: number;
    key?: string;
    autoStopAtMs?: number;
    markActivity?: boolean;
  }): void {
    const key = input.key || this.actionKey(input.item, input.type);

    const existing = this.activeFlowTimer();
    if (existing && String(existing.key || '') !== String(key || '')) {
      // If the only running timer is the auto-idle one, finalize it and continue.
      if (String(existing.key || '') === this.involuntaryIdleKey) {
        this.stopFlowTimerForKey(this.involuntaryIdleKey, true);
      } else {
        this.bumpFlowCounter('blockedStartOther');
        this.logEvent('flow_timer_start_blocked', { runningKey: existing.key, requestedKey: key });
        return;
      }
    }

    if (input.markActivity !== false) {
      this.touchRegisteredNow();
    }

    const start = Date.now();
    const baseSeconds = Math.max(0, Math.floor(Number(input?.baseSeconds) || 0));
    const payload: ActiveFlowTimerPersisted = {
      key,
      start,
      baseSeconds,
      item: String(input?.item || ''),
      type: String(input?.type || ''),
      tma: Math.max(0, Math.floor(Number(input?.tmaSeconds) || 0)),
      savedAtIso: new Date().toISOString(),
    };

    const autoStopAtMs = input?.autoStopAtMs;
    if (Number.isFinite(Number(autoStopAtMs)) && Number(autoStopAtMs) > 0) {
      payload.autoStopAtMs = Number(autoStopAtMs);
    }
    this.activeFlowTimer.set(payload);
    this.storage.setActiveFlowTimer(payload);
    this.startFlowTickerIfNeeded();

    // Ensure mode/body classes update immediately (e.g. manual lunch mode).
    this.applyBodyClasses();

    this.bumpFlowCounter('timerStarts');
    this.logEvent('flow_timer_started', { key, item: payload.item, type: payload.type, baseSeconds: payload.baseSeconds });
  }

  stopFlowTimerForKey(key: string, finalize: boolean): { item: string; type: string; tma: number; totalSeconds: number } | null {
    const t = this.activeFlowTimer();
    if (!t || String(t.key || '') !== String(key || '')) return null;
    const elapsed = Math.floor((Date.now() - Number(t.start)) / 1000);
    const total = Math.max(0, Math.floor(Number(t.baseSeconds) || 0) + Math.max(0, elapsed));
    const item = String(t.item || '');
    const type = String(t.type || '');
    const tma = Math.max(0, Math.floor(Number(t.tma) || 0));

    this.activeFlowTimer.set(null);
    this.storage.clearActiveFlowTimer();
    this.stopFlowTicker();

    this.bumpFlowCounter('timerStops');
    this.logEvent('flow_timer_stopped', { key, finalize, totalSeconds: total });

    if (finalize) {
      this.addTransaction({
        item,
        type: type as any,
        tma,
        timeSpent: total,
        timestamp: new Date().toLocaleString(),
        source: 'flow',
        assistant: null,
      });
    } else {
      this.setPausedWork(key, { item, type, tma, accumulatedSeconds: total });
    }

    this.applyBodyClasses();

    return { item, type, tma, totalSeconds: total };
  }

  downloadEndDayExport(): void {
    this.bumpCounter('endDayExport');
    this.logEvent('end_day_export', {});
    const exportDateIso = new Date().toISOString();
    const currentSeconds = this.nowSeconds();
    const doneTransactions = (this.transactions() || []).length;

    const payload = {
      exportSchemaVersion: 3,
      exportDate: exportDateIso,
      app: {
        name: 'TMA Compensator',
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
        language: typeof navigator !== 'undefined' ? navigator.language : null,
      },
      settings: {
        balanceMarginSeconds: BALANCE_MARGIN_SECONDS,
        shiftStartSeconds: this.shiftStartSeconds(),
        shiftEndSeconds: this.shiftEndSeconds(),
        lunchStartSeconds: this.lunchStartSeconds(),
        lunchEndSeconds: this.lunchEndSeconds(),
        showComplexa: this.showComplexa(),
        darkThemeEnabled: this.darkThemeEnabled(),
        flowMode: this.flowModeEnabled(),
      },
      snapshot: {
        now: {
          currentSeconds,
          currentClock: secondsToClockHHMM(currentSeconds),
        },
        balance: {
          seconds: this.balanceSeconds(),
          withinMargin: Math.abs(this.balanceSeconds()) <= BALANCE_MARGIN_SECONDS,
          marginSeconds: BALANCE_MARGIN_SECONDS,
        },
        quota: {
          doneTransactions,
        },
      },
      transactions: this.transactions(),
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    try {
      const a = document.createElement('a');
      a.href = url;
      a.download = `TMA_Compensator_${exportDateIso.split('T')[0]}.json`;
      a.click();
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  configureOnboarding(
    input: { shiftStartHHMM?: string; lunchStartHHMM: string; showComplexa: boolean },
    opts?: { close?: boolean },
  ): void {
    const shiftRaw = String(input.shiftStartHHMM || '').trim();
    let nextShiftStart = DEFAULT_SHIFT_START_SECONDS;
    if (shiftRaw) {
      const parsedShift = parseClockHHMMToSeconds(shiftRaw);
      if (parsedShift === null) throw new Error('Formato de horário inválido para início do turno. Use HH:MM');
      const max = 24 * 3600 - SHIFT_TOTAL_SECONDS;
      if (parsedShift > max) {
        throw new Error(`Horário de início do turno muito tarde. Use um valor até ${secondsToClockHHMM(max)}.`);
      }
      nextShiftStart = this.normalizeShiftStartSeconds(parsedShift);
    }

    const lunchRaw = String(input.lunchStartHHMM || '').trim();
    const parsedLunch = parseClockHHMMToSeconds(lunchRaw);
    if (parsedLunch === null) throw new Error('Formato de horário inválido. Use HH:MM');

    const lunchStart = parsedLunch;
    const lunchEnd = lunchStart + 3600; // Legacy: 1 hour

    this.shiftStartSeconds.set(nextShiftStart);
    this.storage.setShiftStartSeconds(nextShiftStart);

    this.lunchStartSeconds.set(lunchStart);
    this.lunchEndSeconds.set(lunchEnd);
    this.storage.setLunchWindow({ start: lunchStart, end: lunchEnd });

    this.bumpLunchConfigured();
    this.logEvent('lunch_configured', { start: lunchStart, end: lunchEnd });

    this.setShowComplexa(Boolean(input.showComplexa));

    this.needsOnboarding.set(false);
    const shouldClose = opts?.close !== false;
    if (shouldClose) this.onboardingOpen.set(false);
    this.applyBodyClasses();

    if (this.cloudEnabled()) {
      void this.cloud!.upsertSettingsFromState(this.exportSettingsForCloud());
    }
  }

  applyCloudSettings(row: {
    shift_start_seconds: number;
    lunch_start_seconds: number | null;
    lunch_end_seconds: number | null;
    show_complexa: boolean;
    dark_theme_enabled: boolean;
    lunch_style_enabled: boolean;
  }): void {
    // Apply settings without re-upload loops (CloudSyncService gates uploads via isApplyingRemote).
    const shift = this.normalizeShiftStartSeconds(Number(row.shift_start_seconds));
    this.shiftStartSeconds.set(shift);
    this.storage.setShiftStartSeconds(shift);

    const lunchStart = row.lunch_start_seconds === null ? null : Math.max(0, Math.floor(Number(row.lunch_start_seconds) || 0));
    const lunchEnd = row.lunch_end_seconds === null ? null : Math.max(0, Math.floor(Number(row.lunch_end_seconds) || 0));
    this.lunchStartSeconds.set(lunchStart);
    this.lunchEndSeconds.set(lunchEnd);
    if (lunchStart !== null && lunchEnd !== null) this.storage.setLunchWindow({ start: lunchStart, end: lunchEnd });

    this.darkThemeEnabled.set(Boolean(row.dark_theme_enabled));
    this.storage.setDarkThemeEnabled(Boolean(row.dark_theme_enabled));

    this.showComplexa.set(Boolean(row.show_complexa));
    this.storage.setShowComplexa(Boolean(row.show_complexa));

    this.lunchStyleEnabled.set(Boolean(row.lunch_style_enabled));
    this.applyBodyClasses();

    // Onboarding is only required if lunch/shift is missing.
    this.needsOnboarding.set(lunchStart === null || lunchEnd === null || !Number.isFinite(shift));
    this.onboardingOpen.set(this.needsOnboarding());
  }

  private bumpLunchConfigured(): void {
    const a = this.ensureAnalytics();
    const next: AnalyticsState = {
      ...a,
      lastUpdatedAtIso: new Date().toISOString(),
      lunch: {
        ...a.lunch,
        configuredCount: (Number((a.lunch as any)?.configuredCount) || 0) + 1,
      },
    };
    this.persistAnalytics(next);
  }

  addTransaction(tx: Omit<LegacyTransaction, 'difference' | 'creditedMinutes'>): void {
    // If the auto-idle timer is running and the user records something, end the idle state first.
    this.ensureInvoluntaryIdleStopped();

    this.touchRegisteredNow();

    const isTimeTracker = String((tx as any)?.type || '') === TIME_TRACKER_TYPE;
    const rawDifference = (Number(tx.timeSpent) || 0) - (Number(tx.tma) || 0);
    const difference = isTimeTracker ? 0 : rawDifference;
    const creditedMinutes = isTimeTracker ? 0 : Math.round(Math.abs(difference) / 60);

    const createdAtIso = String((tx as any)?.createdAtIso || '').trim() || new Date().toISOString();

    const nextTx: LegacyTransaction = {
      ...tx,
      createdAtIso,
      difference,
      creditedMinutes,
    };

    // Optimistic local insert.
    const optimisticId = `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const optimistic: LegacyTransaction = { ...nextTx, id: optimisticId };

    if (!isTimeTracker) {
      this.balanceSeconds.set((Number(this.balanceSeconds()) || 0) + difference);
    }
    this.transactions.set([optimistic, ...(this.transactions() || [])]);

    this.bumpCounter('txAdded');
    this.logEvent('tx_added', { item: nextTx.item, type: nextTx.type, tma: nextTx.tma, timeSpent: nextTx.timeSpent });

    this.persist();

    // Fire-and-forget cloud insert; when it returns, replace optimistic local id.
    if (this.cloudEnabled()) {
      void this.cloud!
        .insertTransactionFromState(optimistic)
        .then(created => {
          if (!created || !created.id) return;
          // Replace the optimistic entry by id.
          const list = this.transactions() || [];
          const idx = list.findIndex(t => String((t as any)?.id || '') === optimisticId);
          if (idx < 0) return;
          const next = list.slice();
          next[idx] = { ...created };
          this.transactions.set(next);
          this.recomputeBalanceFromTransactions();
          this.persist();
        })
        .catch(() => {
          // ignore (will remain local-only)
        });
    }
  }

  deleteTransactionAt(index: number): void {
    const list = this.transactions() || [];
    if (!Number.isFinite(index) || index < 0 || index >= list.length) return;

    const tx = list[index];
    const isTimeTracker = String((tx as any)?.type || '') === TIME_TRACKER_TYPE;
    const diff = isTimeTracker ? 0 : Number(tx?.difference) || 0;

    // Legacy behavior: removing a tx subtracts its difference from balance
    if (!isTimeTracker) {
      this.balanceSeconds.set((Number(this.balanceSeconds()) || 0) - diff);
    }

    const next = list.slice();
    next.splice(index, 1);
    this.transactions.set(next);

    this.bumpCounter('txDeleted');
    this.logEvent('tx_deleted', { index, item: (tx as any)?.item, type: (tx as any)?.type, tma: (tx as any)?.tma });

    this.persist();

    if (this.cloudEnabled()) {
      void this.cloud!.deleteTransactionFromState(tx as any).catch(() => {
        // ignore
      });
    }
  }

  replaceTransactionsFromCloud(list: LegacyTransaction[]): void {
    const next = Array.isArray(list) ? list.slice() : [];
    this.transactions.set(next);
    this.syncLastRegisteredFromTransactions(next);
    this.recomputeBalanceFromTransactions();
    this.persist();
  }

  mergeCloudTransaction(tx: LegacyTransaction): void {
    const id = String((tx as any)?.id || '').trim();
    if (!id) return;

    const list = this.transactions() || [];
    const idx = list.findIndex(t => String((t as any)?.id || '') === id);
    const next = list.slice();
    if (idx >= 0) next[idx] = { ...tx };
    else next.unshift({ ...tx });

    this.transactions.set(next);
    this.syncLastRegisteredFromTransactions([tx]);
    this.recomputeBalanceFromTransactions();
    this.persist();
  }

  removeCloudTransactionById(id: string): void {
    const key = String(id || '').trim();
    if (!key) return;
    const list = this.transactions() || [];
    const next = list.filter(t => String((t as any)?.id || '') !== key);
    this.transactions.set(next);
    this.recomputeBalanceFromTransactions();
    this.persist();
  }

  private recomputeBalanceFromTransactions(): void {
    const list = this.transactions() || [];
    let sum = 0;
    for (const t of list) {
      if (String((t as any)?.type || '') === TIME_TRACKER_TYPE) continue;
      sum += Number((t as any)?.difference) || 0;
    }
    this.balanceSeconds.set(Math.floor(sum));
  }

  private exportSettingsForCloud(): {
    shiftStartSeconds: number;
    lunchStartSeconds: number | null;
    lunchEndSeconds: number | null;
    showComplexa: boolean;
    darkThemeEnabled: boolean;
    lunchStyleEnabled: boolean;
  } {
    return {
      shiftStartSeconds: Math.max(0, Math.floor(Number(this.shiftStartSeconds()) || 0)),
      lunchStartSeconds: this.lunchStartSeconds(),
      lunchEndSeconds: this.lunchEndSeconds(),
      showComplexa: Boolean(this.showComplexa()),
      darkThemeEnabled: Boolean(this.darkThemeEnabled()),
      lunchStyleEnabled: Boolean(this.lunchStyleEnabled()),
    };
  }

  private persist(): void {
    this.storage.setBalanceSeconds(this.balanceSeconds());
    this.storage.setTransactions(this.transactions());
  }

  private normalizeShiftStartSeconds(seconds: number): number {
    const s = Math.floor(Number(seconds));
    const max = 24 * 3600 - SHIFT_TOTAL_SECONDS;
    if (!Number.isFinite(s)) return DEFAULT_SHIFT_START_SECONDS;
    return Math.min(Math.max(0, s), max);
  }

  private startClock(): void {
    this.syncNowSeconds();
    setInterval(() => this.syncNowSeconds(), 1000);
  }

  private syncNowSeconds(): void {
    const debug = this.debugTimeSeconds();
    if (debug !== null && Number.isFinite(debug)) {
      const normalized = ((Math.floor(debug) % (24 * 3600)) + 24 * 3600) % (24 * 3600);
      this.nowSeconds.set(normalized);
      this.applyBodyClasses();
      return;
    }

    const now = new Date();
    const sec = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
    this.nowSeconds.set(sec);
    this.applyBodyClasses();
  }

  private flowTickerId: number | null = null;
  private simTickerId: number | null = null;

  private startFlowTickerIfNeeded(): void {
    if (this.flowTickerId !== null) return;
    if (!this.activeFlowTimer()) return;
    this.flowNowMs.set(Date.now());
    this.flowTickerId = window.setInterval(() => {
      this.flowNowMs.set(Date.now());

      const t = this.activeFlowTimer();
      const stopAt = Number(t?.autoStopAtMs);
      if (t && Number.isFinite(stopAt) && stopAt > 0 && Date.now() >= stopAt) {
        // Auto-finalize (used by Almoço Time Tracker)
        this.stopFlowTimerForKey(String(t.key || ''), true);
      }
    }, 100);
  }

  private stopFlowTicker(): void {
    if (this.flowTickerId === null) return;
    try {
      clearInterval(this.flowTickerId);
    } catch {
      // ignore
    }
    this.flowTickerId = null;
  }

  private startSimTickerIfNeeded(): void {
    if (this.simTickerId !== null) return;
    if (!this.simRunning()) return;

    if (this.debugTimeSeconds() === null) {
      const now = new Date();
      const sec = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
      this.debugTimeSeconds.set(sec);
      this.syncNowSeconds();
    }

    let lastMs = Date.now();
    this.simTickerId = window.setInterval(() => {
      if (!this.simRunning()) {
        this.stopSimTicker();
        return;
      }
      const nowMs = Date.now();
      const dtMs = Math.max(0, nowMs - lastMs);
      lastMs = nowMs;
      const speed = Number(this.simSpeed()) || 60;
      const addSeconds = (dtMs / 1000) * speed;
      const prev = Number(this.debugTimeSeconds()) || 0;
      const next = (prev + addSeconds) % (24 * 3600);
      this.debugTimeSeconds.set(next);
      this.syncNowSeconds();
    }, 250);
  }

  private stopSimTicker(): void {
    if (this.simTickerId === null) return;
    try {
      clearInterval(this.simTickerId);
    } catch {
      // ignore
    }
    this.simTickerId = null;
  }

  private makeSessionId(): string {
    return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  }

  private createAnalytics(): AnalyticsState {
    const nowIso = new Date().toISOString();
    return {
      schemaVersion: 1,
      sessionId: this.makeSessionId(),
      createdAtIso: nowIso,
      lastUpdatedAtIso: nowIso,
      settings: {
        dailyQuota: DAILY_QUOTA,
        balanceMarginSeconds: BALANCE_MARGIN_SECONDS,
        shiftStartSeconds: this.shiftStartSeconds(),
        shiftEndSeconds: this.shiftEndSeconds(),
      },
      counters: {
        txAdded: 0,
        txDeleted: 0,
        resetAll: 0,
        endDayExport: 0,
      },
      assistant: {
        detailsOpens: 0,
        detailsCloses: 0,
        recommendationsShown: 0,
        recommendationsFollowed: 0,
        perType: {},
        lastRecoSig: null,
        lastReco: null,
      },
      flow: {
        modeEnabledCount: 0,
        modeDisabledCount: 0,
        timerStarts: 0,
        timerStops: 0,
        blockedStartOther: 0,
        blockedLeaveWithRunning: 0,
      },
      lunch: {
        configuredCount: 0,
      },
      debug: {
        setDebugTimeCount: 0,
        resetDebugTimeCount: 0,
        simStartCount: 0,
        simPauseCount: 0,
        simResetCount: 0,
      },
      ui: {
        assistantSimplified: true,
      },
      eventLog: [],
    };
  }

  private loadOrInitAnalytics(): void {
    const raw = this.storage.getAnalyticsRaw();
    const defaults = this.createAnalytics();
    const src = raw && typeof raw === 'object' ? (raw as any) : {};

    const merged: AnalyticsState = {
      ...(src || {}),
      ...defaults,
      schemaVersion: Number(src?.schemaVersion) || defaults.schemaVersion,
      sessionId: String(src?.sessionId || defaults.sessionId),
      createdAtIso: String(src?.createdAtIso || defaults.createdAtIso),
      lastUpdatedAtIso: String(src?.lastUpdatedAtIso || defaults.lastUpdatedAtIso),
      settings: {
        ...defaults.settings,
        ...(src?.settings && typeof src.settings === 'object' ? src.settings : {}),
      },
      counters: {
        ...defaults.counters,
        ...(src?.counters && typeof src.counters === 'object' ? src.counters : {}),
      },
      assistant: {
        ...defaults.assistant,
        ...(src?.assistant && typeof src.assistant === 'object' ? src.assistant : {}),
        perType: {
          ...defaults.assistant.perType,
          ...(src?.assistant?.perType && typeof src.assistant.perType === 'object' ? src.assistant.perType : {}),
        },
      },
      flow: {
        ...defaults.flow,
        ...(src?.flow && typeof src.flow === 'object' ? src.flow : {}),
      },
      lunch: {
        ...defaults.lunch,
        ...(src?.lunch && typeof src.lunch === 'object' ? src.lunch : {}),
      },
      debug: {
        ...defaults.debug,
        ...(src?.debug && typeof src.debug === 'object' ? src.debug : {}),
      },
      ui: {
        ...defaults.ui,
        ...(src?.ui && typeof src.ui === 'object' ? src.ui : {}),
      },
      eventLog: Array.isArray(src?.eventLog) ? (src.eventLog as any[]) : defaults.eventLog,
    };

    this.analytics.set(merged);
    this.storage.setAnalyticsRaw(merged);
  }

  private ensureAnalytics(): AnalyticsState {
    const a = this.analytics();
    if (a) return a;
    this.loadOrInitAnalytics();
    return this.analytics() || this.createAnalytics();
  }

  private persistAnalytics(a: AnalyticsState): void {
    this.analytics.set(a);
    this.storage.setAnalyticsRaw(a);
  }

  private bumpCounter(field: keyof AnalyticsState['counters']): void {
    const a = this.ensureAnalytics();
    const next: AnalyticsState = {
      ...a,
      lastUpdatedAtIso: new Date().toISOString(),
      counters: {
        ...a.counters,
        [field]: (Number((a.counters as any)?.[field]) || 0) + 1,
      },
    };
    this.persistAnalytics(next);
  }

  private bumpFlowCounter(field: keyof AnalyticsState['flow']): void {
    const a = this.ensureAnalytics();
    const next: AnalyticsState = {
      ...a,
      lastUpdatedAtIso: new Date().toISOString(),
      flow: {
        ...a.flow,
        [field]: (Number((a.flow as any)?.[field]) || 0) + 1,
      },
    };
    this.persistAnalytics(next);
  }

  private bumpDebugCounter(field: keyof AnalyticsState['debug']): void {
    const a = this.ensureAnalytics();
    const next: AnalyticsState = {
      ...a,
      lastUpdatedAtIso: new Date().toISOString(),
      debug: {
        ...a.debug,
        [field]: (Number((a.debug as any)?.[field]) || 0) + 1,
      },
    };
    this.persistAnalytics(next);
  }

  private logEvent(type: string, data: any): void {
    const a = this.ensureAnalytics();
    const nowIso = new Date().toISOString();
    const ev = {
      type: String(type || 'event'),
      tsIso: nowIso,
      currentSeconds: this.nowSeconds(),
      realSeconds: (() => {
        const d = new Date();
        return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
      })(),
      debugTimeSeconds: this.debugTimeSeconds(),
      flowMode: this.flowModeEnabled(),
      isLunch: this.isLunchNow(),
      data: data ?? null,
    };

    const nextLog = [...(a.eventLog || []), ev];
    const capped = nextLog.length > 2000 ? nextLog.slice(nextLog.length - 2000) : nextLog;
    const next: AnalyticsState = {
      ...a,
      lastUpdatedAtIso: nowIso,
      eventLog: capped as any,
    };
    this.persistAnalytics(next);
  }

  private makePausedEntryId(): string {
    return `${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
  }

  private normalizePausedWorkStore(store: unknown): PausedWorkStore {
    const src = store && typeof store === 'object' ? (store as Record<string, unknown>) : {};
    const out: PausedWorkStore = {};
    for (const [key, value] of Object.entries(src)) {
      if (!key) continue;

      if (Array.isArray(value)) {
        const entries = value
          .filter(v => v && typeof v === 'object')
          .map(v => {
            const obj = v as Record<string, unknown>;
            return {
              id: String(obj['id'] || this.makePausedEntryId()),
              item: String(obj['item'] || ''),
              type: String(obj['type'] || ''),
              tma: Number(obj['tma']) || 0,
              accumulatedSeconds: Math.max(0, Math.floor(Number(obj['accumulatedSeconds']) || 0)),
              updatedAtIso: String(obj['updatedAtIso'] || new Date().toISOString()),
            } satisfies PausedWorkEntry;
          })
          .filter(e => e.item && e.type && e.accumulatedSeconds > 0);
        if (entries.length) out[key] = entries;
        continue;
      }

      if (value && typeof value === 'object') {
        const obj = value as Record<string, unknown>;
        const secs = Math.max(0, Math.floor(Number(obj['accumulatedSeconds']) || 0));
        const item = String(obj['item'] || '');
        const type = String(obj['type'] || '');
        if (secs > 0 && item && type) {
          out[key] = [
            {
              id: String(obj['id'] || this.makePausedEntryId()),
              item,
              type,
              tma: Number(obj['tma']) || 0,
              accumulatedSeconds: secs,
              updatedAtIso: String(obj['updatedAtIso'] || new Date().toISOString()),
            },
          ];
        }
      }
    }
    return out;
  }

  private getPausedEntriesForKey(key: string, storeOverride?: PausedWorkStore): PausedWorkEntry[] {
    const store = storeOverride || this.pausedWork();
    const v = store && key ? (store as any)[key] : null;
    if (Array.isArray(v)) return v as PausedWorkEntry[];
    if (v && typeof v === 'object') return [v as PausedWorkEntry];
    return [];
  }

  private getLunchWindowWithinShift(): { start: number; end: number } | null {
    const s = this.lunchStartSeconds();
    const e = this.lunchEndSeconds();
    if (s === null || e === null) return null;
    const start = this.shiftStartSeconds();
    const end = this.shiftEndSeconds();
    if (!Number.isFinite(s) || !Number.isFinite(e)) return null;
    if (e <= s) return null;
    // Clamp to shift bounds
    const cs = Math.min(Math.max(s, start), end);
    const ce = Math.min(Math.max(e, start), end);
    if (ce <= cs) return null;
    return { start: cs, end: ce };
  }

  private computeRemainingWorkSeconds(): number {
    const now = this.nowSeconds();
    const shiftStart = this.shiftStartSeconds();
    const shiftEnd = this.shiftEndSeconds();
    const lunch = this.getLunchWindowWithinShift();

    const intervals: Array<{ start: number; end: number }> = [];
    if (!lunch) {
      intervals.push({ start: shiftStart, end: shiftEnd });
    } else {
      intervals.push({ start: shiftStart, end: lunch.start });
      intervals.push({ start: lunch.end, end: shiftEnd });
    }

    let remaining = 0;
    for (const it of intervals) {
      const s = it.start;
      const e = it.end;
      if (e <= s) continue;
      if (now <= s) remaining += (e - s);
      else if (now >= e) remaining += 0;
      else remaining += (e - now);
    }
    return Math.max(0, Math.floor(remaining));
  }

  private applyBodyClasses(): void {
    try {
      const body = typeof document !== 'undefined' ? document.body : null;
      if (!body) {
        // In some boot sequences the service can run before <body> exists.
        // Retry on next tick so motion preferences don't permanently disable transitions.
        setTimeout(() => this.applyBodyClasses(), 0);
        return;
      }

			// Keep sidebar transitions enabled even under prefers-reduced-motion.
			body.classList.add('force-sidebar-animations');
      // Keep welcome/onboarding transitions enabled even under prefers-reduced-motion.
      body.classList.add('force-welcome-animations');

      body.classList.toggle('dark-theme', Boolean(this.darkThemeEnabled()));
      body.classList.toggle('lunch-mode', Boolean(this.lunchModeEnabled()));
      body.classList.toggle('flow-mode', Boolean(this.flowModeEnabled()));

      // Note: we intentionally do NOT use the legacy `welcome-lock` behavior here.
      // It can result in a blank screen if the modal is momentarily hidden.
      // The onboarding modal itself provides the UI lock via overlay + pointer-events.
    } catch {
      // ignore
    }
  }
}
