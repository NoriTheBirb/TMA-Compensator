import { CommonModule } from '@angular/common';
import { Component, HostListener, computed, effect, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

import type { AccountAction } from '../../core/models/account-action';
import type { LegacyTransaction } from '../../core/models/transaction';
import type { ActiveFlowTimerPersisted, PausedWorkEntry } from '../../core/models/paused-work';
import { AuthService } from '../../core/services/auth.service';
import { CompanionService } from '../../core/services/companion.service';
import { ProfileService } from '../../core/services/profile.service';
import { AppStateService } from '../../core/state/app-state.service';
import {
  formatSignedTime,
  secondsToClockHHMM,
  secondsToTime as formatSecondsToTime,
  timeToSeconds as parseTimeToSeconds,
} from '../../core/utils/time';

@Component({
  selector: 'app-main-page',
  imports: [CommonModule, FormsModule],
  templateUrl: './main-page.html',
  styleUrl: './main-page.css',
})
export class MainPage {
  private prevActiveFlowTimer: ActiveFlowTimerPersisted | null = null;

  constructor(
    protected readonly state: AppStateService,
    private readonly auth: AuthService,
    protected readonly profile: ProfileService,
    protected readonly companion: CompanionService,
    private readonly router: Router,
  ) {
		try {
			document.body?.classList?.add('force-sidebar-animations');
      document.body?.classList?.add('force-welcome-animations');
		} catch {
			// ignore
		}

    // Apply a CSS hook for Time Tracker mode.
    effect(() => {
      const enabled = this.profile.timeTrackerEnabled();
      try {
        document.body?.classList?.toggle('time-tracker-mode', Boolean(enabled));
      } catch {
        // ignore
      }
    });

    let prevOnboardingOpen = false;
    effect(() => {
      const open = this.state.onboardingOpen();

      if (open && !prevOnboardingOpen) {
        // Always show the form immediately.
        // Relying on staged intro timers can occasionally result in a visually empty modal (blank overlay).
        this.showWelcomeFormImmediately();
      }

      if (!open && prevOnboardingOpen) {
        this.clearWelcomeTimers();
        this.resetWelcomeClasses();
      }

      prevOnboardingOpen = open;
    });

    // Time Tracker users: enable inactivity auto-tracking ("Ociosidade involuntaria").
    effect(() => {
      this.state.setTimeTrackerModeEnabled(this.profile.timeTrackerEnabled());
    });

    // Companion nudges (low-noise; cooldown-protected).
    effect(() => {
      const k = this.state.assistantKpis();
      if (!k) return;

      // Only nudge during the active day.
      if (k.dayPart?.key === 'post') return;

      // Behind schedule.
      if (Number(k.quotaDelta) <= -3) {
        this.companion.nudge(
          'quota_behind',
          `Você está ${k.quotaDelta} atrás da meta agora. Se fizer o básico bem feito, você recupera.`,
          'simple',
          { autoCloseMs: 6500, minIntervalMs: 18 * 60 * 1000 },
        );
      }

      // Balance drifting too far.
      const bal = Number(this.state.balanceSeconds()) || 0;
      if (Math.abs(bal) >= 20 * 60) {
        this.companion.nudge(
          'saldo_far',
          'Seu saldo tá ficando longe de 0. Faz 2–3 contas com setup bem padrão pra estabilizar.',
          'complex',
          { autoCloseMs: 8000, minIntervalMs: 25 * 60 * 1000 },
        );
      }
    });

    // Companion: lunch transitions (schedule or manual lunch timer).
    let prevLunch = false;
    effect(() => {
      const lunch = this.state.lunchModeEnabled();
      if (lunch && !prevLunch) {
        this.companion.sayLunchStart('schedule');
      } else if (!lunch && prevLunch) {
        this.companion.sayLunchBack('schedule');
      }
      prevLunch = lunch;
    });

    // Companion: end-of-day approaching + ended.
    let prevStatus = '';
    effect(() => {
      const status = String(this.state.statusLabel() || '');
      const remainingWork = Math.max(0, Math.floor(Number(this.state.remainingWorkSeconds()) || 0));

      // When close to end (<= 20 minutes), give a single reminder.
      if (status === 'Trabalhando' && remainingWork > 0 && remainingWork <= 20 * 60) {
        this.companion.sayEndOfDaySoon(this.state.turnoWorkLeftHuman());
      }

      // When shift ends.
      if (status === 'Turno encerrado' && prevStatus !== 'Turno encerrado') {
        this.companion.sayShiftEnded();
      }

      prevStatus = status;
    });

    // Companion: speak when a Flow timer auto-finalizes (e.g. Almoço / Pausa max time).
    effect(() => {
      const current = this.state.activeFlowTimer();
      if (!current && this.prevActiveFlowTimer) {
        const prev = this.prevActiveFlowTimer;
        const stopAtMs = Number((prev as any)?.autoStopAtMs);
        if (Number.isFinite(stopAtMs) && stopAtMs > 0 && Date.now() >= stopAtMs) {
          const baseSeconds = Math.max(0, Math.floor(Number((prev as any)?.baseSeconds) || 0));
          const startMs = Number((prev as any)?.start) || 0;
          const elapsed = Math.max(0, Math.floor((Math.min(Date.now(), stopAtMs) - startMs) / 1000));
          const totalSeconds = baseSeconds + elapsed;
          const item = String((prev as any)?.item || '');
          const type = String((prev as any)?.type || '');
          const tmaSeconds = Math.max(0, Math.floor(Number((prev as any)?.tma) || 0));

          this.maybeSpeakTimeTrackerFinalize(item, type, true, totalSeconds);
          this.maybeSpeakAccountFinalize(item, type, true, totalSeconds, tmaSeconds);
        }
      }
      this.prevActiveFlowTimer = current;
    });
  }

  protected setCompanionEnabled(enabled: boolean): void {
    this.companion.setEnabled(Boolean(enabled));
  }

  protected companionHelp(): void {
    this.companion.speak(
      'Eu posso:\n\n- Te lembrar do ritmo (quando você fica muito atrás)\n- Avisar quando o saldo tá distorcendo muito\n- Dar bronca antes de cair em Ociosidade involuntária (Time Tracker)\n\nSe eu estiver chato, desliga ali no switch 😅',
      'complex',
      { title: 'Noir', autoCloseMs: 12000 },
    );
  }

  protected companionTip(): void {
    const k = this.state.assistantKpis();
    const behind = k ? Number(k.quotaDelta) < 0 : false;
    this.companion.speak(
      behind
        ? 'Dica rápida: recupera ritmo reduzindo variação. Faz 3 contas seguidas no “setup padrão”.'
        : 'Dica rápida: consistência > velocidade. Padroniza início/meio/fim da conta.',
      'simple',
      { title: 'Dica', autoCloseMs: 7000 },
    );
  }

	protected readonly sidebarOpen = signal(false);
  protected readonly sidebarClosing = signal(false);
  protected readonly sidebarShown = computed(() => this.sidebarOpen() || this.sidebarClosing());
  private sidebarCloseTimer: number | null = null;

  protected readonly helloName = computed(() => {
    const profName = String(this.profile.username() || '').trim();
    if (profName) return profName;

    const u: any = this.auth.user();
    const meta = String(u?.user_metadata?.username || '').trim();
    if (meta) return meta;

    const email = String(u?.email || '').trim();
    if (email.includes('@')) return email.split('@')[0];

    return '';
  });

  protected goToAdmin(ev?: Event): void {
    try {
      ev?.preventDefault?.();
    } catch {
      // ignore
    }
    try {
      this.closeSidebar();
    } catch {
      // ignore
    }
    void this.router.navigateByUrl('/admin');
  }

  protected readonly debugPanelOpen = signal(false);

  protected readonly mainTab = signal<'accounts' | 'timeTracker'>('accounts');

  protected readonly timeTrackerCodeInput = signal('');
  protected readonly timeTrackerSaving = signal(false);
  protected readonly timeTrackerSuccess = signal('');
  protected readonly timeTrackerError = signal('');

  protected readonly assistantDetailsOpen = signal(false);

  protected readonly welcomeStage = signal<'intro' | 'form' | 'outro' | null>(null);
  protected readonly welcomeSuccess = signal(false);
  protected readonly welcomeCollapsing = signal(false);
  protected readonly welcomeGreetingText = signal('Bem-vindo!');
  protected readonly welcomeOutroRunning = signal(false);

  protected async logout(): Promise<void> {
    this.closeSidebar();
    try {
      await this.auth.signOut();
    } catch (e) {
      console.error('Logout failed', e);
    }

    try {
      await this.router.navigateByUrl('/auth');
    } catch {
      // ignore
    }
  }

  protected async submitTimeTrackerCode(): Promise<void> {
    this.timeTrackerSuccess.set('');
    this.timeTrackerError.set('');

    const code = String(this.timeTrackerCodeInput() || '').trim();
    if (!code) {
      this.timeTrackerError.set('Digite o código.');
      return;
    }

    this.timeTrackerSaving.set(true);
    try {
      const ok = await this.profile.enableTimeTracker(code);
      if (!ok) {
        this.timeTrackerError.set('Código inválido.');
        return;
      }

      this.timeTrackerCodeInput.set('');
      this.timeTrackerSuccess.set('Modo Time Tracker ativado.');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Falha ao validar código.';
      this.timeTrackerError.set(msg);
    } finally {
      this.timeTrackerSaving.set(false);
    }
  }

  protected async disableTimeTrackerMode(): Promise<void> {
    this.timeTrackerSuccess.set('');
    this.timeTrackerError.set('');
    this.timeTrackerSaving.set(true);
    try {
      await this.profile.disableTimeTracker();
      this.timeTrackerSuccess.set('Modo Time Tracker desativado.');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Falha ao desativar.';
      this.timeTrackerError.set(msg);
    } finally {
      this.timeTrackerSaving.set(false);
    }
  }

  private welcomeIntroTimerA: number | null = null;
  private welcomeIntroTimerB: number | null = null;
  private welcomeOutroTimerA: number | null = null;
  private welcomeOutroTimerB: number | null = null;
  private welcomeOutroTimerC: number | null = null;
  private welcomeOutroTimerD: number | null = null;

  protected readonly accounts = signal<ReadonlyArray<{ name: string; actions: AccountAction[] }>>([
    {
      name: 'Sociedade Simples',
      actions: [
        { item: 'Sociedade Simples', type: 'conferencia', tmaSeconds: 2132, label: '📋 Conferencia' },
        { item: 'Sociedade Simples', type: 'retorno', tmaSeconds: 900, label: '🔄 Retorno' },
      ],
    },
    {
      name: 'Complexa',
      actions: [
        { item: 'Complexa', type: 'conferencia', tmaSeconds: 4860, label: '📋 Conferencia' },
        { item: 'Complexa', type: 'retorno', tmaSeconds: 2700, label: '🔄 Retorno' },
      ],
    },
    {
      name: 'Empresaria Limitada',
      actions: [
        { item: 'Empresaria Limitada', type: 'conferencia', tmaSeconds: 3032, label: '📋 Conferencia' },
        { item: 'Empresaria Limitada', type: 'retorno', tmaSeconds: 1440, label: '🔄 Retorno' },
      ],
    },
    {
      name: 'Micro Empresario Individual',
      actions: [
        { item: 'Micro Empresario Individual', type: 'conferencia', tmaSeconds: 1980, label: '📋 Conferencia' },
        { item: 'Micro Empresario Individual', type: 'retorno', tmaSeconds: 900, label: '🔄 Retorno' },
      ],
    },
  ]);

  protected readonly timeTrackerOptions = signal<ReadonlyArray<{ name: string; action: AccountAction }>>([
    { name: 'Pausa', action: { item: 'Pausa', type: 'time_tracker', tmaSeconds: 0, label: 'Pausa' } },
    { name: 'Almoço', action: { item: 'Almoço', type: 'time_tracker', tmaSeconds: 0, label: 'Almoço' } },
    { name: 'Falha sistemica', action: { item: 'Falha sistemica', type: 'time_tracker', tmaSeconds: 0, label: 'Falha sistemica' } },
    { name: 'Ociosidade', action: { item: 'Ociosidade', type: 'time_tracker', tmaSeconds: 0, label: 'Ociosidade' } },
    { name: 'Processo interno', action: { item: 'Processo interno', type: 'time_tracker', tmaSeconds: 0, label: 'Processo interno' } },
    { name: 'Daily', action: { item: 'Daily', type: 'time_tracker', tmaSeconds: 0, label: 'Daily' } },
  ]);

  protected readonly visibleAccounts = computed(() => {
    const showComplexa = this.state.showComplexa();
    return (this.accounts() || []).filter(a => showComplexa || a.name !== 'Complexa');
  });

  protected readonly modalOpen = signal(false);
  protected readonly modalAction = signal<AccountAction | null>(null);
  protected readonly timeInput = signal('');
  protected readonly resumePausedContext = signal<{ key: string; entryId: string } | null>(null);

  protected readonly flowChoiceOpen = signal(false);
  protected readonly flowChoiceTitle = signal('');
  protected readonly flowChoiceText = signal('');
  protected readonly flowChoiceFinalizeLabel = signal('Finalizar');
  protected readonly flowChoiceParalyzeLabel = signal('Paralisar');
  protected readonly flowChoiceCancelLabel = signal('Cancelar');
  private flowChoiceHandler: ((choice: 'finalize' | 'paralyze' | 'cancel') => void) | null = null;

  protected readonly balanceText = computed(() => formatSignedTime(this.state.balanceSeconds()));
  protected readonly transactions = computed(() => this.state.transactions());

  private readonly involuntaryIdleItem = 'Ociosidade involuntaria';
  private readonly timeTrackerType = 'time_tracker';

  protected readonly visibleHistoryTransactions = computed(() => {
    const list = this.transactions() || [];
    if (this.profile.isAdmin()) return list;

    return list.filter(t => {
      const item = String((t as any)?.item || '').trim();
      const type = String((t as any)?.type || '').trim();
      return !(item === this.involuntaryIdleItem && type === this.timeTrackerType);
    });
  });

  protected readonly onboardingShiftStart = signal('');
  protected readonly onboardingLunchStart = signal('');
  protected readonly onboardingShowComplexa = signal(false);

  protected readonly debugTimeInput = signal('');
  protected readonly simSpeedInput = signal(60);

  protected openModal(action: AccountAction, opts?: { resumeEntryId?: string }): void {
    this.modalAction.set(action);
    this.timeInput.set('');

    const key = this.state.actionKey(action.item, action.type);
    const resumeEntryId = String(opts?.resumeEntryId || '').trim();
    const pausedEntry = resumeEntryId ? this.state.getPausedEntryById(key, resumeEntryId) : null;
    this.resumePausedContext.set(pausedEntry ? { key, entryId: resumeEntryId } : null);

    this.modalOpen.set(true);
  }

  protected openSidebar(): void {
    if (this.sidebarCloseTimer) {
      window.clearTimeout(this.sidebarCloseTimer);
      this.sidebarCloseTimer = null;
    }
    this.sidebarClosing.set(false);
    this.sidebarOpen.set(true);

    // Always start at the top of the sidebar list.
    try {
      requestAnimationFrame(() => {
        const body = document.querySelector('#sidebar .sidebar-body') as HTMLElement | null;
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

  protected exportEndDay(): void {
    this.companion.sayFinishWorkDay('normal');
    this.state.downloadEndDayExport();
    this.closeSidebar();
  }

  protected endWorkDayFromTurnoBox(): void {
    this.exportEndDay();
  }

  protected closeModal(): void {
    this.modalOpen.set(false);
    this.modalAction.set(null);
    this.timeInput.set('');
    this.resumePausedContext.set(null);
  }

  protected confirmModal(): void {
    const action = this.modalAction();
    if (!action) return;

    const key = this.state.actionKey(action.item, action.type);
    const ctx = this.resumePausedContext();
    const ctxPaused = ctx && ctx.key === key ? this.state.getPausedEntryById(key, ctx.entryId) : null;
    const pausedSeconds = ctxPaused ? Math.max(0, Math.floor(Number(ctxPaused.accumulatedSeconds) || 0)) : 0;

    const raw = this.timeInput().trim();
    const enteredSeconds = raw ? parseTimeToSeconds(raw) : pausedSeconds > 0 ? 0 : null;
    if (enteredSeconds === null) {
      alert('Formato inválido. Use HH:MM, HH:MM:SS ou minutos (ex.: 12)');
      return;
    }

    const timeSpent = pausedSeconds > 0 ? pausedSeconds + enteredSeconds : enteredSeconds;

    const tx: Omit<LegacyTransaction, 'difference' | 'creditedMinutes'> = {
      item: action.item,
      type: action.type,
      tma: action.tmaSeconds,
      timeSpent,
      timestamp: new Date().toLocaleString(),
      source: 'modal',
      assistant: null,
    };

    this.state.addTransaction(tx);

    // Noir feedback when finishing (modal = always finalize).
    this.maybeSpeakTimeTrackerFinalize(action.item, action.type, true, timeSpent);
    this.maybeSpeakAccountFinalize(action.item, action.type, true, timeSpent, action.tmaSeconds);

    // Resolve ONLY the paused entry being resumed.
    if (ctx && ctx.key === key && ctx.entryId) {
      this.state.removePausedEntry(key, ctx.entryId);
    }

    this.closeModal();
  }

  protected paralyzeFromModal(): void {
    const action = this.modalAction();
    if (!action) return;
    const key = this.state.actionKey(action.item, action.type);

    const ctx = this.resumePausedContext();
    const ctxPaused = ctx && ctx.key === key ? this.state.getPausedEntryById(key, ctx.entryId) : null;
    const existingPaused = ctxPaused
      ? Math.max(0, Math.floor(Number(ctxPaused.accumulatedSeconds) || 0))
      : this.state.getPausedSecondsForKey(key);

    const raw = this.timeInput().trim();
    const parsed = raw ? parseTimeToSeconds(raw) : null;
    const seconds = parsed !== null ? existingPaused + parsed : existingPaused;

    if (!Number.isFinite(seconds) || seconds < 0) {
      alert('Tempo inválido para paralisar. Use HH:MM:SS ou minutos.');
      return;
    }

    if (ctx && ctx.key === key && ctx.entryId) {
      const ok = this.state.updatePausedEntry(key, ctx.entryId, {
        item: action.item,
        type: action.type,
        tma: action.tmaSeconds,
        accumulatedSeconds: seconds,
        updatedAtIso: new Date().toISOString(),
      });
      if (!ok) {
        this.state.setPausedWork(key, { item: action.item, type: action.type, tma: action.tmaSeconds, accumulatedSeconds: seconds });
      }
    } else {
      this.state.setPausedWork(key, { item: action.item, type: action.type, tma: action.tmaSeconds, accumulatedSeconds: seconds });
    }

    this.closeModal();
  }

  protected submitOnboarding(): void {
    try {
      this.state.configureOnboarding(
        {
          shiftStartHHMM: this.onboardingShiftStart().trim() || undefined,
          lunchStartHHMM: this.onboardingLunchStart().trim(),
          showComplexa: Boolean(this.onboardingShowComplexa()),
        },
        { close: false },
      );

      // Legacy: play outro animation and close afterwards.
      this.playWelcomeOutroAndClose();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Falha ao salvar configurações.');
    }
  }

  protected openOnboardingFromSettings(): void {
    this.onboardingShiftStart.set(secondsToClockHHMM(this.state.shiftStartSeconds()));
    this.onboardingLunchStart.set(
      this.state.lunchStartSeconds() !== null ? secondsToClockHHMM(this.state.lunchStartSeconds()!) : '',
    );
    this.onboardingShowComplexa.set(Boolean(this.state.showComplexa()));

    // Opening from settings should show the fields immediately.
    this.showWelcomeFormImmediately();

    this.state.openOnboarding();
		this.closeSidebar();
  }

  protected closeOnboarding(): void {
    this.state.closeOnboarding();
  }

  protected onAssistantDetailsToggle(ev: Event): void {
    try {
      const el = ev.target as any;
      this.assistantDetailsOpen.set(Boolean(el?.open));
    } catch {
      // ignore
    }
  }

  @HostListener('document:keydown', ['$event'])
  protected onGlobalKeydown(ev: KeyboardEvent): void {
    const target = ev.target as HTMLElement | null;
    const tag = String(target?.tagName || '').toLowerCase();
    const isTyping = tag === 'input' || tag === 'textarea' || Boolean((target as any)?.isContentEditable);
    if (isTyping) return;

    const isF2 = ev.key === 'F2' || ev.code === 'F2';
    const isCtrlAltD = ev.ctrlKey && ev.altKey && (ev.code === 'KeyD' || String(ev.key || '').toLowerCase() === 'd');
    if (!isF2 && !isCtrlAltD) return;

    try {
      ev.preventDefault();
    } catch {
      // ignore
    }

    this.debugPanelOpen.set(!this.debugPanelOpen());
  }

  private clearWelcomeTimers(): void {
    for (const t of [
      this.welcomeIntroTimerA,
      this.welcomeIntroTimerB,
      this.welcomeOutroTimerA,
      this.welcomeOutroTimerB,
      this.welcomeOutroTimerC,
      this.welcomeOutroTimerD,
    ]) {
      if (t) {
        try {
          clearTimeout(t);
        } catch {
          // ignore
        }
      }
    }
    this.welcomeIntroTimerA = null;
    this.welcomeIntroTimerB = null;
    this.welcomeOutroTimerA = null;
    this.welcomeOutroTimerB = null;
    this.welcomeOutroTimerC = null;
    this.welcomeOutroTimerD = null;
  }

  private resetWelcomeClasses(): void {
    this.welcomeStage.set(null);
    this.welcomeSuccess.set(false);
    this.welcomeCollapsing.set(false);
    this.welcomeGreetingText.set('Bem-vindo!');
    this.welcomeOutroRunning.set(false);
  }

  private startWelcomeIntroSequence(): void {
    if (!this.state.onboardingOpen()) return;
    this.clearWelcomeTimers();
    this.welcomeOutroRunning.set(false);

    this.welcomeSuccess.set(false);
    this.welcomeCollapsing.set(false);
    this.welcomeStage.set('intro');
    this.welcomeGreetingText.set('Bem-vindo!');

    this.welcomeIntroTimerA = window.setTimeout(() => {
      if (!this.state.onboardingOpen()) return;
      this.welcomeStage.set('form');

      this.welcomeIntroTimerB = window.setTimeout(() => {
        try {
          const shift = document.getElementById('shiftStartInput') as HTMLInputElement | null;
          const lunch = document.getElementById('lunchInput') as HTMLInputElement | null;
          (shift || lunch)?.focus();
        } catch {
          // ignore
        }
      }, 700);
    }, 1100);
  }

  private showWelcomeFormImmediately(): void {
    this.clearWelcomeTimers();
    this.welcomeOutroRunning.set(false);
    this.welcomeSuccess.set(false);
    this.welcomeCollapsing.set(false);
    this.welcomeGreetingText.set('Configurar turno e almoço');
    this.welcomeStage.set('form');
  }

  private playWelcomeOutroAndClose(): void {
    if (!this.state.onboardingOpen()) return;
    if (this.welcomeOutroRunning()) return;
    this.welcomeOutroRunning.set(true);
    this.clearWelcomeTimers();

    // Apply the outro stage immediately so the form can disappear on the same tick
    // (prevents inputs/buttons overlapping the outro/success animation).
    this.welcomeStage.set('outro');

    this.welcomeOutroTimerA = window.setTimeout(() => {
      this.welcomeGreetingText.set('Bom trabalho!');
    }, 420);

    this.welcomeOutroTimerB = window.setTimeout(() => {
      this.welcomeSuccess.set(true);
    }, 520);

    this.welcomeOutroTimerC = window.setTimeout(() => {
      this.welcomeCollapsing.set(true);
    }, 2550);

    this.welcomeOutroTimerD = window.setTimeout(() => {
      this.welcomeOutroRunning.set(false);
      this.state.closeOnboarding();
      this.resetWelcomeClasses();
    }, 3050);
  }

  protected toggleDarkTheme(next: boolean): void {
    this.state.setDarkThemeEnabled(Boolean(next));
  }

  protected toggleComplexa(next: boolean): void {
    this.state.setShowComplexa(Boolean(next));
  }

	protected toggleFlowMode(next: boolean): void {
    if (this.profile.timeTrackerEnabled() && !Boolean(next)) {
      alert('No modo Time Tracker, o Flow é obrigatório.');
      return;
    }
		if (!Boolean(next) && this.state.activeFlowKey()) {
			alert('Não dá para desligar o Flow com um timer em andamento. Pare o timer primeiro.');
			return;
		}
		this.state.setFlowModeEnabled(Boolean(next));
	}

  protected goToReport(ev?: Event): void {
    try {
      ev?.preventDefault?.();
    } catch {
      // ignore
    }
    try {
      this.closeSidebar();
    } catch {
      // ignore
    }
    void this.router.navigateByUrl('/report');
  }

  protected toggleLunchStyle(next: boolean): void {
    this.state.setLunchStyleEnabled(Boolean(next));
  }

  protected applyDebugTime(): void {
    try {
      this.state.setDebugTimeFromInput(this.debugTimeInput());
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Falha ao definir horário de debug');
    }
  }

  protected resetDebugTime(): void {
    this.debugTimeInput.set('');
    this.state.resetDebugTime();
  }

  protected updateSimSpeed(raw: any): void {
    const v = Number(raw);
    this.simSpeedInput.set(Number.isFinite(v) && v > 0 ? v : 60);
    this.state.setSimSpeed(this.simSpeedInput());
  }

  protected startSim(): void {
    this.state.setSimSpeed(this.simSpeedInput());
    this.state.startOrResumeSim();
  }

  protected pauseSim(): void {
    this.state.pauseSim();
  }

  protected stopSim(): void {
    this.state.stopAndResetSim();
  }

  protected actionButtonLabel(action: AccountAction): string {
    if (!this.state.flowModeEnabled()) return action.label;
    const key = this.state.actionKey(action.item, action.type);
    return this.state.activeFlowKey() === key ? 'Parar' : action.label;
  }

  protected actionButtonClass(action: AccountAction): string {
    if (!this.state.flowModeEnabled()) return '';
    const key = this.state.actionKey(action.item, action.type);
    return this.state.activeFlowKey() === key ? 'start-btn' : '';
  }

  protected isActionDisabled(action: AccountAction): boolean {
    const key = this.state.actionKey(action.item, action.type);
    return this.state.isFlowActionDisabled(key);
  }

  protected clickAction(action: AccountAction): void {
    if (!this.state.flowModeEnabled()) {
      this.openModal(action);
      return;
    }
    this.handleFlowTimer(action);
  }

  protected resumePaused(entry: { key: string; entryId: string; item: string; type: string; tma: number }): void {
    this.openModal({ item: entry.item, type: entry.type as any, tmaSeconds: entry.tma, label: '' }, { resumeEntryId: entry.entryId });
  }

  protected discardPaused(entry: { key: string; entryId: string }): void {
    if (!confirm('Excluir este pausado?')) return;
    this.state.removePausedEntry(entry.key, entry.entryId);
  }

  protected closeFlowChoice(): void {
    this.flowChoiceOpen.set(false);
    this.flowChoiceHandler = null;
  }

  private openFlowChoice(
    cfg: { title: string; text: string; finalizeLabel: string; paralyzeLabel: string; cancelLabel: string },
    handler: (choice: 'finalize' | 'paralyze' | 'cancel') => void,
  ): void {
    this.flowChoiceTitle.set(cfg.title);
    this.flowChoiceText.set(cfg.text);
    this.flowChoiceFinalizeLabel.set(cfg.finalizeLabel);
    this.flowChoiceParalyzeLabel.set(cfg.paralyzeLabel);
    this.flowChoiceCancelLabel.set(cfg.cancelLabel);
    this.flowChoiceHandler = handler;
    this.flowChoiceOpen.set(true);
  }

  protected chooseFlowChoice(choice: 'finalize' | 'paralyze' | 'cancel'): void {
    const h = this.flowChoiceHandler;
    this.closeFlowChoice();
    try {
      h?.(choice);
    } catch {
      // ignore
    }
  }

  private maybeSpeakTimeTrackerFinalize(item: string, type: string, finalized: boolean, totalSeconds?: number): void {
    if (!finalized) return;
    if (String(type || '') !== this.timeTrackerType) return;

    const itemText = String(item || '');
    this.companion.sayTimeTrackerFinish(itemText);

    // Business rule: Pausa max is 15 minutes.
    if (itemText === 'Pausa' && Number.isFinite(Number(totalSeconds))) {
      this.companion.sayPauseLimit(Number(totalSeconds));
    }
  }

  private maybeSpeakAccountFinalize(item: string, type: string, finalized: boolean, timeSpentSeconds?: number, tmaSeconds?: number): void {
    if (!finalized) return;
    if (String(type || '') === this.timeTrackerType) return;

    const spent = Number(timeSpentSeconds);
    const tma = Number(tmaSeconds);
    if (Number.isFinite(spent) && spent > 0 && Number.isFinite(tma) && tma > 0) {
      this.companion.sayAccountTmaFeedback({
        item: String(item || ''),
        type: String(type || ''),
        tmaSeconds: tma,
        timeSpentSeconds: spent,
      });
      return;
    }

    this.companion.sayAccountFinish(String(item || ''), String(type || ''));
  }

  private handleFlowTimer(action: AccountAction, opts?: { resumeEntryId?: string; forceNew?: boolean }): void {
    const key = this.state.actionKey(action.item, action.type);
    const activeKey = this.state.activeFlowKey();

    // If the only running timer is the involuntary idle one, auto-finalize it and proceed.
    // This must never block the user from registering a new account or time tracker action.
    const idleKey = this.state.actionKey(this.involuntaryIdleItem, this.timeTrackerType);
    if (activeKey && activeKey === idleKey && activeKey !== key) {
      this.state.stopFlowTimerForKey(activeKey, true);
      // Re-enter with a fresh activeKey so we don't show the swap prompt.
      this.handleFlowTimer(action, opts);
      return;
    }

    if (activeKey && activeKey !== key) {
      const t = this.state.activeFlowTimer();
      const activeLabel = t ? `${t.item} • ${this.typeLabel(String(t.type || ''))}` : 'conta atual';
      const nextLabel = `${action.item} • ${this.typeLabel(action.type)}`;
      this.openFlowChoice(
        {
          title: 'Trocar de conta',
          text: `Timer atual:\n• ${activeLabel}\n\nPróxima conta:\n• ${nextLabel}\n\nEscolha o que fazer com o timer atual:`,
          finalizeLabel: 'Finalizar e iniciar',
          paralyzeLabel: 'Paralisar e iniciar',
          cancelLabel: 'Cancelar',
        },
        choice => {
          if (choice !== 'finalize' && choice !== 'paralyze') return;

          try {
            const t = this.state.activeFlowTimer();
            const totalSeconds = t
              ? Math.max(0, Math.floor(Number((t as any)?.baseSeconds) || 0) + Math.max(0, Math.floor((Date.now() - Number((t as any)?.start)) / 1000)))
              : undefined;
            const tmaSeconds = t ? Math.max(0, Math.floor(Number((t as any)?.tma) || 0)) : undefined;
            this.maybeSpeakTimeTrackerFinalize(String(t?.item || ''), String(t?.type || ''), choice === 'finalize', totalSeconds);
            this.maybeSpeakAccountFinalize(String(t?.item || ''), String(t?.type || ''), choice === 'finalize', totalSeconds, tmaSeconds);
          } catch {
            // ignore
          }

          this.state.stopFlowTimerForKey(activeKey, choice === 'finalize');
          this.handleFlowTimer(action, opts);
        },
      );
      return;
    }

    const resumeEntryId = String(opts?.resumeEntryId || '').trim();
    const forceNew = Boolean(opts?.forceNew);

    if (this.state.activeFlowTimer() && activeKey === key) {
      this.openFlowChoice(
        {
          title: 'Paralisar ou finalizar?',
          text: `Conta:\n• ${action.item} • ${this.typeLabel(action.type)}\n\nFinalizar:\n• Salva no histórico\n\nParalisar:\n• Guarda o tempo para retomar depois`,
          finalizeLabel: 'Finalizar',
          paralyzeLabel: 'Paralisar',
          cancelLabel: 'Continuar rodando',
        },
        choice => {
          if (choice !== 'finalize' && choice !== 'paralyze') return;

          const t = this.state.activeFlowTimer();
          const totalSeconds = t
            ? Math.max(0, Math.floor(Number((t as any)?.baseSeconds) || 0) + Math.max(0, Math.floor((Date.now() - Number((t as any)?.start)) / 1000)))
            : undefined;
          const tmaSeconds = t ? Math.max(0, Math.floor(Number((t as any)?.tma) || 0)) : undefined;
          this.maybeSpeakTimeTrackerFinalize(action.item, action.type, choice === 'finalize', totalSeconds);
          this.maybeSpeakAccountFinalize(action.item, action.type, choice === 'finalize', totalSeconds, tmaSeconds);
          this.state.stopFlowTimerForKey(key, choice === 'finalize');
        },
      );
      return;
    }

    if (!resumeEntryId && !forceNew) {
      const pausedCount = this.state.getPausedCountForKey(key);
      if (pausedCount > 0) {
        const latest = this.state.getLatestPausedEntry(key);
        const latestSecs = Math.max(0, Math.floor(Number(latest?.accumulatedSeconds) || 0));
        this.openFlowChoice(
          {
            title: 'Contas pausadas',
            text: `Já existem ${pausedCount} pausado(s) para:\n• ${action.item} • ${this.typeLabel(action.type)}\n\nÚltimo pausado: ${formatSecondsToTime(latestSecs)}\n\nO que você quer fazer agora?`,
            finalizeLabel: 'Retomar último',
            paralyzeLabel: 'Iniciar nova',
            cancelLabel: 'Cancelar',
          },
          choice => {
            if (choice === 'finalize') {
              this.handleFlowTimer(action, { resumeEntryId: String(latest?.id || '') });
            } else if (choice === 'paralyze') {
              this.handleFlowTimer(action, { forceNew: true });
            }
          },
        );
        return;
      }
    }

    const resumedEntry: PausedWorkEntry | null =
      forceNew ? null : resumeEntryId ? this.state.getPausedEntryById(key, resumeEntryId) : this.state.getLatestPausedEntry(key);
    const baseSeconds = Math.max(0, Math.floor(Number(resumedEntry?.accumulatedSeconds) || 0));

    if (baseSeconds > 0 && resumedEntry?.id) {
      this.state.removePausedEntry(key, String(resumedEntry.id));
    }


    // Auto-stop rules for Time Tracker items.
    // - Almoço: 60 minutes (legacy)
    // - Pausa: 15 minutes (requested)
    const isTimeTracker = String(action.type || '') === this.timeTrackerType;
    const itemText = String(action.item || '');
    const enabledTT = this.profile.timeTrackerEnabled() && isTimeTracker;

    let autoStopAtMs: number | undefined = undefined;
    if (enabledTT && itemText === 'Almoço') {
      const remaining = Math.max(0, 60 * 60 - baseSeconds);
      autoStopAtMs = Date.now() + remaining * 1000;
    } else if (enabledTT && itemText === 'Pausa') {
      const remaining = Math.max(0, 15 * 60 - baseSeconds);
      autoStopAtMs = Date.now() + remaining * 1000;
    }

    // Companion dialogues: account start + lunch start.
    const isLunch = isTimeTracker && itemText === 'Almoço';
    if (isLunch) {
      this.companion.sayLunchStart('manual');
      this.companion.sayTimeTrackerStart('Almoço');
    } else if (!isTimeTracker) {
      this.companion.sayStartAccount({ item: action.item, type: action.type }, { minIntervalMs: 75_000 });
    } else {
      this.companion.sayTimeTrackerStart(itemText);
    }

    this.state.startFlowTimer({ item: action.item, type: action.type, tmaSeconds: action.tmaSeconds, baseSeconds, key, autoStopAtMs });
  }

  protected deleteTx(tx: LegacyTransaction): void {
    const list = this.state.transactions() || [];
    const id = String((tx as any)?.id || '').trim();
    const createdAtIso = String((tx as any)?.createdAtIso || '').trim();

    const idx =
      id
        ? list.findIndex(t => String((t as any)?.id || '') === id)
        : list.findIndex(t =>
            String((t as any)?.createdAtIso || '') === createdAtIso &&
            String((t as any)?.timestamp || '') === String((tx as any)?.timestamp || '') &&
            String((t as any)?.item || '') === String((tx as any)?.item || '') &&
            String((t as any)?.type || '') === String((tx as any)?.type || '') &&
            Number((t as any)?.timeSpent || 0) === Number((tx as any)?.timeSpent || 0) &&
            Number((t as any)?.tma || 0) === Number((tx as any)?.tma || 0)
          );

    if (idx < 0) return;

    const txForPrompt = list[idx];
    const item = String((txForPrompt as any)?.item || '');
    const type = String((txForPrompt as any)?.type || '');
    if (!confirm(`Excluir este lançamento?\n\n${item} - ${type}`)) return;
    this.state.deleteTransactionAt(idx);
  }

  protected typeLabel(type: string): string {
    const t = String(type || '');
    return t ? t.charAt(0).toUpperCase() + t.slice(1) : '';
  }

  protected diffClass(diffSeconds: number): string {
    const d = Number(diffSeconds) || 0;
    if (Math.abs(d) <= 600) return 'neutral';
    return d >= 0 ? 'positive' : 'negative';
  }

  protected secondsToTime(totalSeconds: number): string {
    return formatSecondsToTime(totalSeconds);
  }

  protected signed(seconds: number): string {
    return formatSignedTime(seconds);
  }
}
