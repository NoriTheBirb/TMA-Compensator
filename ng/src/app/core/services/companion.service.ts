import { Injectable, signal, effect } from '@angular/core';
import type { RealtimeChannel } from '@supabase/supabase-js';

import { AuthService } from './auth.service';
import { SupabaseService } from './supabase.service';
import { formatSignedTime, secondsToTime as formatSecondsToTime } from '../utils/time';

export type CompanionState =
  | 'idle'
  | 'reading-idle'
  | 'speaking'
  | 'reading-speaking'
  | 'angry'
  | 'admin-message';

type SpeakKind = 'simple' | 'complex' | 'scold';

type DialogueTone = 'normal' | 'scold';

const LS_HIDDEN = 'tma_companion_hidden_v1';
const LS_NUDGE_PREFIX = 'tma_companion_nudge_';
const LS_LAST_BROADCAST_ID = 'tma_last_broadcast_id_v1';

function lsGetBool(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return raw === '1' || raw === 'true';
  } catch {
    return fallback;
  }
}

function lsSetBool(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? '1' : '0');
  } catch {
    // ignore
  }
}

@Injectable({ providedIn: 'root' })
export class CompanionService {
  // Served via Angular assets (see angular.json): { input: 'src/app/images', output: 'images' }
  // IMPORTANT: resolve against document.baseURI so it works on nested routes (/admin, /report, ...)
  private assetUrl(path: string): string {
    try {
      return new URL(String(path || ''), document.baseURI).toString();
    } catch {
      return String(path || '');
    }
  }

  private readonly imgIdle = this.assetUrl('images/Idle (1).png');
  private readonly imgReadingIdle = this.assetUrl('images/Reading-idle (1).png');
  private readonly imgSpeaking = this.assetUrl('images/Speaking (1).png');
  private readonly imgReadingSpeaking = this.assetUrl('images/Reading-speaking_bg_removed.png.png');
  private readonly imgAngry = this.assetUrl('images/Angry_bg_removed.png.png');
  private readonly imgAdminMessage = this.assetUrl('images/admin-message.png');

  readonly hidden = signal<boolean>(lsGetBool(LS_HIDDEN, false));
  readonly open = signal<boolean>(false);

  readonly state = signal<CompanionState>('idle');
  readonly title = signal<string>('Noir');
  readonly text = signal<string>('');

  private idleFlip = false;
  private idleTicker: number | null = null;
  private autoCloseTimer: number | null = null;

  private broadcastsRealtime?: RealtimeChannel;
  private broadcastsPollTimer: number | null = null;

  constructor(
    private readonly sb: SupabaseService,
    private readonly auth: AuthService,
  ) {
    this.ensureIdleTicker();

    effect(() => {
      const ready = this.sb.ready();
      const uid = this.auth.userId();
      if (!ready || !uid) {
        this.disposeBroadcastsRealtime();
        return;
      }
      this.ensureBroadcastsRealtime();
    });

    // Global warning events (from AppStateService).
    window.addEventListener('tt_idle_warning', (ev: Event) => {
      const detail = (ev as CustomEvent<any>)?.detail;
      const remainingSec = Math.max(0, Math.floor(Number(detail?.remainingSec) || 0));
      const remainingText = remainingSec ? `${remainingSec}s` : 'agora';

      // Desktop notification (best-effort; requires browser permission).
      this.tryDesktopNotify(
        'Noir — Ociosidade involuntária',
        `Você vai entrar em Ociosidade involuntária em ${remainingText}. Registra uma ação ou inicia um timer.`,
        { tag: 'tma-tt-idle-warning', renotify: true },
      );

      this.speak(
        `Ei — você vai entrar em Ociosidade involuntária em ${remainingText}. Registra uma ação ou inicia um timer.`,
        'scold',
        { autoCloseMs: 6500 },
      );
    });
  }

  private tryDesktopNotify(
    title: string,
    body: string,
    opts?: { tag?: string; renotify?: boolean; silent?: boolean },
  ): boolean {
    try {
      if (typeof window === 'undefined') return false;
      if (!('Notification' in window)) return false;

      const permission = (window as any).Notification?.permission as NotificationPermission | undefined;
      if (permission !== 'granted') {
        // Request permission opportunistically. Some browsers require user gesture; ignore failures.
        try {
          void (window as any).Notification?.requestPermission?.();
        } catch {
          // ignore
        }
        return false;
      }

      const options: any = {
        body: String(body || ''),
        tag: opts?.tag ? String(opts.tag) : undefined,
        silent: Boolean(opts?.silent),
      };
      if (typeof opts?.renotify !== 'undefined') options.renotify = Boolean(opts.renotify);

      const n = new Notification(String(title || 'Notificação'), options);

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
      return true;
    } catch {
      return false;
    }
  }

  sayPauseLimit(totalSecondsRaw: number): void {
    const totalSeconds = Math.max(0, Math.floor(Number(totalSecondsRaw) || 0));
    const limit = 15 * 60;
    if (totalSeconds <= 0) return;

    if (totalSeconds > limit) {
      this.nudge(
        'tt_pause_over_15',
        'Essa pausa passou de 15 minutos (máximo). Bora voltar e registrar direitinho pra não estourar o dia.',
        'scold',
        { autoCloseMs: 9000, minIntervalMs: 8 * 60 * 1000 },
      );
      return;
    }

    if (totalSeconds >= limit) {
      this.nudge(
        'tt_pause_hit_15',
        'Fechou 15 minutos de pausa. Bora voltar pro jogo.',
        'simple',
        { autoCloseMs: 7000, minIntervalMs: 8 * 60 * 1000 },
      );
    }
  }

  private disposeBroadcastsRealtime(): void {
    try {
      this.broadcastsRealtime?.unsubscribe();
    } catch {
      // ignore
    }
    this.broadcastsRealtime = undefined;

    if (this.broadcastsPollTimer != null) {
      try {
        window.clearInterval(this.broadcastsPollTimer);
      } catch {
        // ignore
      }
      this.broadcastsPollTimer = null;
    }
  }

  private getLastBroadcastId(): string {
    try {
      return String(localStorage.getItem(LS_LAST_BROADCAST_ID) || '').trim();
    } catch {
      return '';
    }
  }

  private setLastBroadcastId(id: string): void {
    const v = String(id || '').trim();
    if (!v) return;
    try {
      localStorage.setItem(LS_LAST_BROADCAST_ID, v);
    } catch {
      // ignore
    }
  }

  private showBroadcastRow(row: any, opts?: { silent?: boolean }): void {
    const id = String(row?.id || '').trim();
    if (!id) return;

    const last = this.getLastBroadcastId();
    if (last && last === id) return;

    // Update first to dedupe against quick successive events.
    this.setLastBroadcastId(id);

    const msg = String(row?.message || '').trim();
    if (!msg) return;
    if (opts?.silent) return;

    const kind = String(row?.kind || 'info').trim().toLowerCase();
    const sender = String(row?.created_by_username || '').trim();
    const senderSuffix = sender ? `: ${sender}` : '';
    const title =
      kind === 'danger'
        ? `Alerta (Admin${senderSuffix})`
        : kind === 'warning'
          ? `Aviso (Admin${senderSuffix})`
          : `Mensagem (Admin${senderSuffix})`;
    this.speak(msg, 'simple', { title, autoCloseMs: 16000, avatar: 'admin-message' });
  }

  private async pollBroadcasts(opts?: { silentIfUninitialized?: boolean }): Promise<void> {
    if (!this.sb.ready() || !this.auth.userId()) return;

    try {
      const { data, error } = await this.sb.supabase
        .from('broadcasts')
        .select('id,message,kind,created_at,created_by_username')
        .order('created_at', { ascending: false })
        .limit(10);
      if (error) return;

      const rows = Array.isArray(data) ? data : [];
      if (!rows.length) return;

      const lastId = this.getLastBroadcastId();

      // First run: just mark current latest as seen, so we don't pop an old message on page load.
      if (!lastId && opts?.silentIfUninitialized) {
        this.setLastBroadcastId(String(rows[0]?.id || ''));
        return;
      }

      // Show any rows newer than lastId (oldest first).
      if (!lastId) {
        this.showBroadcastRow(rows[0]);
        return;
      }

      const newer: any[] = [];
      for (const r of rows) {
        if (String(r?.id || '').trim() === lastId) break;
        newer.push(r);
      }
      if (!newer.length) return;

      newer.reverse();
      for (const r of newer) this.showBroadcastRow(r);
    } catch {
      // ignore
    }
  }

  private ensureBroadcastsRealtime(): void {
    if (this.broadcastsRealtime) return;

    // Poll fallback makes this feature work even when Realtime isn't enabled for the table
    // or when WS connectivity is blocked.
    void this.pollBroadcasts({ silentIfUninitialized: true });
    if (this.broadcastsPollTimer == null) {
      this.broadcastsPollTimer = window.setInterval(() => {
        void this.pollBroadcasts();
      }, 20000);
    }

    this.broadcastsRealtime = this.sb.supabase
      .channel('broadcasts-live')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'broadcasts' }, (payload) => {
        const row = (payload as any)?.new;
        this.showBroadcastRow(row);
      })
      .subscribe((status) => {
        // If the subscription fails, polling still delivers messages.
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          // no-op (avoid spamming UI); polling continues
        }
      });
  }

  /** Convenience for UI toggles: enabled=true means visible/usable. */
  setEnabled(enabled: boolean): void {
    this.setHidden(!Boolean(enabled));
  }

  /**
   * Show a message at most once per interval (stored in localStorage).
   * Useful for contextual tips without spamming.
   */
  nudge(
    key: string,
    text: string,
    kind: SpeakKind = 'simple',
    opts?: { title?: string; autoCloseMs?: number; minIntervalMs?: number },
  ): void {
    if (this.hidden()) return;

    const k = String(key || '').trim();
    if (!k) return;

    const minIntervalMs = Math.max(0, Math.floor(Number(opts?.minIntervalMs) || 0));
    if (minIntervalMs > 0) {
      try {
        const raw = localStorage.getItem(`${LS_NUDGE_PREFIX}${k}`);
        const last = raw ? Number(raw) : 0;
        if (Number.isFinite(last) && last > 0 && Date.now() - last < minIntervalMs) return;
      } catch {
        // ignore
      }
    }

    this.speak(text, kind, { title: opts?.title, autoCloseMs: opts?.autoCloseMs });

    try {
      localStorage.setItem(`${LS_NUDGE_PREFIX}${k}`, String(Date.now()));
    } catch {
      // ignore
    }
  }

  imageUrl(): string {
    switch (this.state()) {
      case 'reading-idle':
        return this.imgReadingIdle;
      case 'speaking':
        return this.imgSpeaking;
      case 'reading-speaking':
        return this.imgReadingSpeaking;
      case 'angry':
        return this.imgAngry;
      case 'admin-message':
        return this.imgAdminMessage;
      case 'idle':
      default:
        return this.imgIdle;
    }
  }

  setHidden(hidden: boolean): void {
    this.hidden.set(Boolean(hidden));
    lsSetBool(LS_HIDDEN, Boolean(hidden));
    if (hidden) this.open.set(false);
  }

  toggleOpen(): void {
    if (this.hidden()) return;
    this.open.update((v) => !v);
    if (this.open()) {
      // If the user opens it manually, show a friendly idle line.
      if (!this.text()) {
        this.title.set('Noir');
        this.text.set(this.pickRandom([
          'Tô aqui. Se quiser, eu explico as coisas aos poucos.',
          'Pronto. Me chama quando quiser uma dica rápida.',
          'Quer uma dica? Clica em “Dica rápida”.',
          'Se tiver Time Tracker ligado, eu aviso antes do idle involuntário.',
          'Posso te ajudar a manter consistência sem correria.',
        ]));
      }
      if (this.state() === 'idle' || this.state() === 'reading-idle') this.state.set('speaking');
    } else {
      this.clearAutoClose();
      this.setIdle();
    }
  }

  private pickRandom(lines: string[]): string {
    const arr = Array.isArray(lines) ? lines.filter(Boolean) : [];
    if (!arr.length) return '';
    const i = Math.floor(Math.random() * arr.length);
    return String(arr[i] || '').trim();
  }

  private typeLabel(type: string): string {
    const t = String(type || '').trim();
    if (!t) return '';
    return t.charAt(0).toUpperCase() + t.slice(1);
  }

  sayTimeTrackerFinish(itemRaw: string): void {
    if (this.hidden()) return;

    const raw = String(itemRaw || '').trim();
    if (!raw) return;

    const item = raw.toLowerCase();
    const key = `tt_finish_${item}`;

    const lines = (() => {
      switch (item) {
        case 'pausa':
          return [
            'Pausa finalizada. Agora é hora de transformar café em resultado.',
            'Voltamos. O teclado sentiu sua falta.',
          ];
        case 'almoço':
          return [
            'Almoço finalizado. Bora voltar pro modo “resolve e registra”.',
            'Bem-vindo(a) de volta. Agora sim: foco, calma e consistência.',
          ];
        case 'falha sistemica':
        case 'falha sistêmica':
          return [
            'Falha sistêmica encerrada. Que os servidores tenham piedade hoje.',
            'Voltou. Agora finge que foi tudo “planejado”.',
          ];
        case 'ociosidade':
          return [
            'Ociosidade finalizada. Hora de registrar algo que exista no plano material.',
            'Bora voltar. O relógio tava ganhando de você.',
          ];
        case 'processo interno':
          return [
            'Processo interno finalizado. Checklist feito, consciência tranquila.',
            'Encerrado. Agora é mundo real de novo.',
          ];
        case 'daily':
          return [
            'Daily finalizada. Agora sim: trabalhar de verdade.',
            'Reunião encerrada. Voltamos ao modo execução.',
          ];
        default:
          return [
            `Finalizado: ${raw}.`,
            `Ok — ${raw} encerrado.`,
          ];
      }
    })();

    this.nudge(key, this.pickRandom(lines), 'simple', { title: 'Noir', autoCloseMs: 9000, minIntervalMs: 2 * 60 * 1000 });
  }

  sayAccountFinish(itemRaw: string, typeRaw: string): void {
    if (this.hidden()) return;

    const item = String(itemRaw || '').trim();
    if (!item) return;

    const type = String(typeRaw || '').trim();
    if (!type || type.toLowerCase() === 'time_tracker') return;

    const key = `acc_finish_${item.toLowerCase()}_${type.toLowerCase()}`;
    const typeLabel = this.typeLabel(type);

    const lines = this.pickRandom([
      `Boa. Finalizado: ${item} • ${typeLabel}.`,
      `Fechou ${item} • ${typeLabel}. Agora é só não esquecer do registro.`,
      `Conta encerrada: ${item} • ${typeLabel}. Sem drama, só consistência.`,
      `Finalizou ${item} • ${typeLabel}. Próxima!`,
    ]);

    this.nudge(key, lines, 'simple', { title: 'Noir', autoCloseMs: 8500, minIntervalMs: 60 * 1000 });
  }

  sayAccountTmaFeedback(input: { item: string; type: string; tmaSeconds: number; timeSpentSeconds: number }): void {
    if (this.hidden()) return;

    const item = String(input?.item || '').trim();
    const type = String(input?.type || '').trim();
    if (!item || !type || type.toLowerCase() === 'time_tracker') return;

    const tmaSeconds = Math.max(0, Math.floor(Number(input?.tmaSeconds) || 0));
    const timeSpentSeconds = Math.max(0, Math.floor(Number(input?.timeSpentSeconds) || 0));
    if (!Number.isFinite(tmaSeconds) || !Number.isFinite(timeSpentSeconds) || tmaSeconds <= 0) {
      this.sayAccountFinish(item, type);
      return;
    }

    const diffSeconds = timeSpentSeconds - tmaSeconds;
    const typeLabel = this.typeLabel(type);

    // Target is 0 (timeSpent - TMA). Warn if too above OR too below.
    const goodAbsSeconds = 60; // +/- 1 min
    const warnAbsSeconds = 3 * 60; // +/- 3 min

    const absDiff = Math.abs(diffSeconds);
    const deltaText = formatSignedTime(diffSeconds);
    const headline = `${item} • ${typeLabel}`;

    const verdict = (() => {
      if (absDiff <= goodAbsSeconds) {
        return this.pickRandom(['Perfeito. Diferença perto de 0.', 'Boa! Isso aí é “meta: zero”.', 'Na mosca.'])
      }

      if (absDiff >= warnAbsSeconds) {
        if (diffSeconds > 0) {
          return 'Atenção: acima do TMA. Ajusta pro setup padrão pra voltar pro zero.';
        }
        return 'Atenção: abaixo demais do TMA. Mantém qualidade e padrão pra voltar pro zero.';
      }

      // Mid band: gentle coaching.
      if (diffSeconds > 0) {
        return 'Um pouco acima. Dá pra puxar pro padrão.';
      }
      return 'Um pouco abaixo. Mantém o padrão pra não distorcer.';
    })();

    const kind: SpeakKind = absDiff <= goodAbsSeconds ? 'simple' : absDiff >= warnAbsSeconds ? 'scold' : 'simple';
    const title = absDiff <= goodAbsSeconds ? 'Mandou bem (TMA)' : absDiff >= warnAbsSeconds ? 'Ajuste (TMA)' : 'Feedback (TMA)';

    this.speak(
      `${headline}\nTMA: ${formatSecondsToTime(tmaSeconds)}\nGasto: ${formatSecondsToTime(timeSpentSeconds)}\nDiferença (Gasto - TMA): ${deltaText}\nMeta: 00:00:00\n${verdict}`,
      kind,
      { title, autoCloseMs: 11000 },
    );
  }

  welcomeAuth(mode: 'signin' | 'signup'): void {
    this.speak(
      mode === 'signin'
        ? 'Bem-vindo de volta. Entra aí — seus dados vão sincronizar.'
        : 'Bora criar sua conta. Dica: use um usuário simples (tipo joao.silva).',
      'simple',
      { autoCloseMs: 5000 },
    );
  }

  speak(
    text: string,
    kind: SpeakKind = 'simple',
    opts?: { title?: string; autoCloseMs?: number; avatar?: 'default' | 'admin-message' },
  ): void {
    if (this.hidden()) return;

    const title = String(opts?.title || 'Noir');
    const msg = String(text || '').trim();
    if (!msg) return;

    this.title.set(title);
    this.text.set(msg);

    if (opts?.avatar === 'admin-message') {
      this.state.set('admin-message');
    } else if (kind === 'scold') {
      this.state.set('angry');
    } else if (kind === 'complex') {
      this.state.set('reading-speaking');
    } else {
      this.state.set('speaking');
    }

    this.open.set(true);

    const autoCloseMs = Math.max(0, Math.floor(Number(opts?.autoCloseMs) || 0));
    if (autoCloseMs > 0) {
      this.clearAutoClose();
      this.autoCloseTimer = window.setTimeout(() => {
        this.open.set(false);
        this.text.set('');
        this.setIdle();
      }, autoCloseMs);
    }
  }

  private clearAutoClose(): void {
    if (this.autoCloseTimer === null) return;
    try {
      window.clearTimeout(this.autoCloseTimer);
    } catch {
      // ignore
    }
    this.autoCloseTimer = null;
  }

  private ensureIdleTicker(): void {
    if (this.idleTicker !== null) return;
    this.idleTicker = window.setInterval(() => {
      if (document.hidden) return;
      if (this.hidden()) return;
      if (this.open()) return;
      this.setIdle();
    }, 20000);
  }

  private setIdle(): void {
    this.idleFlip = !this.idleFlip;
    this.state.set(this.idleFlip ? 'reading-idle' : 'idle');
  }

  showHelp(): void {
    this.speak(
      'Eu sou seu copiloto aqui.\n\n- Te dou dicas rápidas\n- Te aviso quando você tá muito atrás da meta\n- Te puxo a orelha antes de entrar em Ociosidade involuntária (Time Tracker)\n\nSe eu estiver atrapalhando, você pode me desligar na barra lateral.',
      'complex',
      { title: 'Noir', autoCloseMs: 14000 },
    );
  }

  showTip(): void {
    this.speak(
      'Dica rápida: consistência > pressa. Padroniza o começo da conta (setup) e você ganha tempo sem “correr”.',
      'simple',
      { title: 'Dica', autoCloseMs: 8000 },
    );
  }

  showMotivation(): void {
    this.speak(
      this.pickRandom([
        'Um passo de cada vez. Mantém o ritmo e o saldo encaixa.',
        'Consistência ganha do “sprint”. Faz limpo e segue.',
        'Se você tá atrás: reduz variação, não aumenta pressa.',
        'Hoje é dia de execução: menos dúvida, mais padrão.',
        'Respira. Uma conta bem feita agora vale por duas corridas.',
      ]),
      'simple',
      { title: 'Motivação', autoCloseMs: 9000 },
    );
  }

  showShortcuts(): void {
    this.speak(
      'Atalhos/fluxo sugerido:\n\n1) Setup padrão (mesma ordem sempre)\n2) Checar bloqueios\n3) Resolver\n4) Registrar\n\nSe estiver em TT: registra uma ação antes de parar pra evitar idle involuntário.',
      'complex',
      { title: 'Atalhos', autoCloseMs: 16000 },
    );
  }

  showTimeTrackerInfo(): void {
    this.speak(
      'Time Tracker:\n\n- Eu aviso antes de entrar em “Ociosidade involuntária”\n- Idle involuntário NÃO aparece no seu histórico (só admin vê)\n- Idle nunca deve travar você: registra uma ação e segue\n\nSe quiser, te dou um lembrete de ritmo também (sem spam).',
      'complex',
      { title: 'Time Tracker', autoCloseMs: 17000 },
    );
  }

  sayStartAccount(action: { item: string; type: string }, opts?: { minIntervalMs?: number }): void {
    const item = String(action?.item || '').trim();
    const type = this.typeLabel(String(action?.type || '').trim());
    if (!item || !type) return;

    const key = `start_${item.toLowerCase()}_${type.toLowerCase()}`.replace(/\s+/g, '_');
    this.nudge(
      key,
      this.pickRandom([
        `Bora. ${item} • ${type}.`,
        `Fechado: ${item} • ${type}. Faz o setup padrão e segue.`,
        `Boa. ${item} • ${type}. Sem pressa, sem erro.`,
        `Ok — ${item} • ${type}. Consistência e vamo.`,
      ]),
      'simple',
      { title: 'Começou', autoCloseMs: 4500, minIntervalMs: Math.max(0, Math.floor(Number(opts?.minIntervalMs) || 0)) || 90_000 },
    );
  }

  sayLunchStart(source: 'schedule' | 'manual' = 'schedule'): void {
    const title = source === 'manual' ? 'Almoço (TT)' : 'Almoço';
    this.nudge(
      'lunch_start',
      this.pickRandom([
        'Hora do almoço. Descansa 10/10 e volta leve.',
        'Vai lá. Água + comida e volta no ritmo.',
        'Almoço: pausa de verdade. Depois a gente acelera com calma.',
      ]),
      'simple',
      { title, autoCloseMs: 9000, minIntervalMs: 20 * 60 * 1000 },
    );
  }

  sayLunchBack(source: 'schedule' | 'manual' = 'schedule'): void {
    const title = source === 'manual' ? 'Volta (TT)' : 'Volta do almoço';
    this.nudge(
      'lunch_back',
      this.pickRandom([
        'Bem-vindo de volta. Bora de “setup padrão” na próxima conta.',
        'Voltou. Agora é ritmo constante, sem sprint.',
        'De volta ao jogo. Uma conta limpa por vez.',
      ]),
      'simple',
      { title, autoCloseMs: 8500, minIntervalMs: 20 * 60 * 1000 },
    );
  }

  sayTimeTrackerStart(itemRaw: string): void {
    const item = String(itemRaw || '').trim();
    if (!item) return;

    const key = `tt_${item.toLowerCase()}`.replace(/\s+/g, '_');
    const title = `TT: ${item}`;

    const msg = (() => {
      switch (item.toLowerCase()) {
        case 'pausa':
          return this.pickRandom([
            'Pausa ativada. Vai lá — mas volta antes que eu comece a sentir saudade.',
            'Pausa. Água, respira, estica. Sem sumir do mapa.',
            'Pausa mode: ON. Seu eu do futuro agradece.',
          ]);
        case 'almoço':
          return this.pickRandom([
            'Almoço: desbloqueado. Come direito e volta no modo máquina (calma).',
            'Hora do rango. Prometo não contar quantos minutos você demorou… muito.',
            'Almoço: ativado. Missão secundária: hidratação.',
          ]);
        case 'falha sistemica':
          return this.pickRandom([
            'Falha sistêmica. O sistema pediu férias hoje.',
            'Falha sistêmica: clássico. Respira — a culpa não é sua.',
            'Sistema caiu? Beleza. Registra direitinho e segue o baile.',
          ]);
        case 'ociosidade':
          return this.pickRandom([
            'Ociosidade. Às vezes o cérebro pede um loading… só não deixa virar temporada.',
            'Ociosidade ativada. Pequena pausa, grande retorno.',
            'Ok, modo “pensando na vida”. Volta já já e a gente recupera.',
          ]);
        case 'processo interno':
          return this.pickRandom([
            'Processo interno: aquele famoso “trabalho invisível”.',
            'Processo interno ativado. Sim, isso conta como trabalho (e eu sei).',
            'Processo interno. Documenta e não se culpa: faz parte.',
          ]);
        case 'daily':
          return this.pickRandom([
            'Daily: hora do “bom dia” corporativo. Sobrevive e volta pro jogo.',
            'Daily ativada. Fala pouco, fala claro, volta rápido.',
            'Daily. Lembrete: câmera optional, consistência mandatory.',
          ]);
        default:
          return `Time Tracker: ${item}.`;
      }
    })();

    this.nudge(key, msg, 'simple', { title, autoCloseMs: 9000, minIntervalMs: 6 * 60 * 1000 });
  }

  sayEndOfDaySoon(remainingHuman: string): void {
    const rem = String(remainingHuman || '').trim();
    this.nudge(
      'end_day_soon',
      this.pickRandom([
        `Tá chegando no fim do turno (${rem} restantes). Fecha as pendências e mantém o padrão.`,
        `Fim do dia chegando (${rem}). Prioriza consistência e registro certinho.`,
        `Último trecho (${rem}). Sem pressa: só não deixa pendência aberta.`,
      ]),
      'complex',
      { title: 'Fim do turno', autoCloseMs: 14000, minIntervalMs: 30 * 60 * 1000 },
    );
  }

  sayShiftEnded(): void {
    this.nudge(
      'shift_ended',
      this.pickRandom([
        'Turno encerrado. Se precisar, finaliza o que faltou e registra direitinho.',
        'Acabou o turno. Fecha o que estiver aberto e finaliza o dia.',
      ]),
      'simple',
      { title: 'Turno', autoCloseMs: 11000, minIntervalMs: 60 * 60 * 1000 },
    );
  }

  sayFinishWorkDay(tone: DialogueTone = 'normal'): void {
    const kind: SpeakKind = tone === 'scold' ? 'scold' : 'simple';
    this.speak(
      this.pickRandom([
        'Fechou. Bom trabalho hoje. Exporta o fim do dia e descansa.',
        'Dia finalizado. Amanhã a gente repete o padrão e melhora um pouco.',
        'Encerrado. Boa. Só confere se tá tudo registrado certinho.',
      ]),
      kind,
      { title: 'Finalizado', autoCloseMs: 12000 },
    );
  }
}
