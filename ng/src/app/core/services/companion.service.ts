import { Injectable, signal, effect, computed } from '@angular/core';
import type { RealtimeChannel } from '@supabase/supabase-js';

import { AuthService } from './auth.service';
import { AppConfigService } from './app-config.service';
import { SupabaseService } from './supabase.service';
import {
  type CompanionMood,
  type CompanionPose,
  type CompanionSpriteKey,
  type CompanionTone,
  COMPANION_PHRASES,
  COMPANION_SPRITES,
} from '../companion/companion-content';
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
const LS_POSITION = 'tma_companion_position_v1';
const LS_SCALE = 'tma_companion_scale_v1';
const LS_NUDGE_PREFIX = 'tma_companion_nudge_';
const LS_LAST_BROADCAST_ID = 'tma_last_broadcast_id_v1';
const LS_UNREAD_BROADCASTS = 'tma_unread_broadcasts_v1';
const LS_RECENT_BROADCASTS = 'tma_recent_broadcasts_v1';

// Keep in sync with `ng/src/app/app.css` defaults.
const COMPANION_DEFAULT_SIZE_PX = 270;
const COMPANION_DEFAULT_MARGIN_PX = 14;
const COMPANION_SCALE_MIN = 0.65;
const COMPANION_SCALE_MAX = 1.55;

type CompanionPosition = { x: number; y: number };

type CompanionContext = {
  sprint: boolean;
  dayPartKey: string;
  quotaDelta: number;
  withinMarginNow: boolean;
  predictedOk: boolean;
  balanceSeconds: number;
  doneTx: number;
  remainingUnits: number;
};

type BroadcastMsg = {
  id: string;
  message: string;
  kind: string;
  created_at: string;
  created_by_username: string;
};

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

function lsGetJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function lsSetJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore
  }
}

function lsGetNumber(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    const n = Number(raw);
    return Number.isFinite(n) ? n : fallback;
  } catch {
    return fallback;
  }
}

function lsSetNumber(key: string, value: number): void {
  try {
    localStorage.setItem(key, String(value));
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
  readonly manualOpen = signal<boolean>(false);
  readonly actionsVisible = computed(() => this.open() && this.manualOpen() && !this.hidden());

  // Visual state (user-configurable)
  readonly scale = signal<number>(this.loadInitialScale());
  readonly sizePx = computed(() => Math.round(COMPANION_DEFAULT_SIZE_PX * this.scale()));

  // Mood state (drives sprites). When state forces (angry/admin-message), it overrides this.
  readonly mood = signal<CompanionMood>('default');
  private moodResetTimer: number | null = null;

  private readonly idleSpriteTick = signal<number>(0);

  readonly context = signal<CompanionContext | null>(null);

  readonly position = signal<CompanionPosition>(this.loadInitialPosition());

  readonly state = signal<CompanionState>('idle');
  readonly title = signal<string>('Noir');
  readonly text = signal<string>('');

  private idleFlip = false;
  private idleTicker: number | null = null;
  private autoCloseTimer: number | null = null;

  private broadcastsRealtime?: RealtimeChannel;
  private broadcastsPollTimer: number | null = null;

  private broadcastPlaybackTimer: number | null = null;

  readonly unreadBroadcasts = signal<BroadcastMsg[]>(this.loadBroadcastList(LS_UNREAD_BROADCASTS));
  readonly recentBroadcasts = signal<BroadcastMsg[]>(this.loadBroadcastList(LS_RECENT_BROADCASTS));
  readonly unreadBroadcastCount = computed(() => this.unreadBroadcasts().length);
  readonly unreadBadgeText = computed(() => {
    const n = this.unreadBroadcastCount();
    if (n <= 0) return '';
    if (n > 9) return '9+';
    return String(n);
  });
  readonly canReplayBroadcasts = computed(() => this.recentBroadcasts().length > 0);

  constructor(
    private readonly sb: SupabaseService,
    private readonly auth: AuthService,
    private readonly appConfig: AppConfigService,
  ) {
    this.ensureIdleTicker();

    // Keep Noir on-screen if viewport changes.
    try {
      window.addEventListener('resize', () => {
        this.setPosition(this.position());
      });
    } catch {
      // ignore
    }

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

      const title = COMPANION_PHRASES.dynamic.ttIdleWarning.title;
      const body = this.formatTemplate(this.pickRandom([...COMPANION_PHRASES.dynamic.ttIdleWarning.body]), {
        remaining: remainingText,
      });

      // Desktop notification (best-effort; requires browser permission).
      this.tryDesktopNotify(
        title,
        body,
        { tag: 'tma-tt-idle-warning', renotify: true },
      );

      this.speak(
        body,
        'scold',
        { autoCloseMs: 6500 },
      );
    });
  }

  setContext(ctx: Partial<CompanionContext> | null | undefined): void {
    if (!ctx) {
      this.context.set(null);
      return;
    }

    const next: CompanionContext = {
      sprint: Boolean((ctx as any).sprint),
      dayPartKey: String((ctx as any).dayPartKey || ''),
      quotaDelta: Number((ctx as any).quotaDelta) || 0,
      withinMarginNow: Boolean((ctx as any).withinMarginNow),
      predictedOk: Boolean((ctx as any).predictedOk),
      balanceSeconds: Number((ctx as any).balanceSeconds) || 0,
      doneTx: Number((ctx as any).doneTx) || 0,
      remainingUnits: Number((ctx as any).remainingUnits) || 0,
    };
    this.context.set(next);
  }

  private clampPosition(posRaw: CompanionPosition): CompanionPosition {
    const x = Math.floor(Number(posRaw?.x) || 0);
    const y = Math.floor(Number(posRaw?.y) || 0);

    const sizePx = Math.max(40, Math.floor(Number(this.sizePx()) || COMPANION_DEFAULT_SIZE_PX));

    // In browsers, keep the square fully in viewport.
    try {
      const vw = Math.max(0, Math.floor(Number(window.innerWidth) || 0));
      const vh = Math.max(0, Math.floor(Number(window.innerHeight) || 0));
      const maxX = Math.max(0, vw - sizePx);
      const maxY = Math.max(0, vh - sizePx);
      return {
        x: Math.min(Math.max(0, x), maxX),
        y: Math.min(Math.max(0, y), maxY),
      };
    } catch {
      return { x: Math.max(0, x), y: Math.max(0, y) };
    }
  }

  private defaultPosition(): CompanionPosition {
    const sizePx = Math.max(40, Math.floor(Number(this.sizePx()) || COMPANION_DEFAULT_SIZE_PX));
    try {
      const vw = Math.max(0, Math.floor(Number(window.innerWidth) || 0));
      const vh = Math.max(0, Math.floor(Number(window.innerHeight) || 0));
      return this.clampPosition({
        x: vw - sizePx - COMPANION_DEFAULT_MARGIN_PX,
        y: vh - sizePx - COMPANION_DEFAULT_MARGIN_PX,
      });
    } catch {
      return { x: 0, y: 0 };
    }
  }

  private loadInitialPosition(): CompanionPosition {
    const raw = lsGetJson<any>(LS_POSITION, null);
    if (raw && typeof raw === 'object') {
      const x = Number(raw.x);
      const y = Number(raw.y);
      if (Number.isFinite(x) && Number.isFinite(y)) return this.clampPosition({ x, y });
    }
    return this.defaultPosition();
  }

  setPosition(posRaw: CompanionPosition): void {
    const next = this.clampPosition(posRaw);
    this.position.set(next);
    lsSetJson(LS_POSITION, next);
  }

  private loadInitialScale(): number {
    const raw = lsGetNumber(LS_SCALE, 1);
    const n = Number.isFinite(raw) ? raw : 1;
    return Math.min(COMPANION_SCALE_MAX, Math.max(COMPANION_SCALE_MIN, n));
  }

  setScale(scaleRaw: number): void {
    const n = Number(scaleRaw);
    const next = Math.min(COMPANION_SCALE_MAX, Math.max(COMPANION_SCALE_MIN, Number.isFinite(n) ? n : 1));
    this.scale.set(next);
    lsSetNumber(LS_SCALE, next);
    // Re-clamp because size affects bounds.
    this.setPosition(this.position());
  }

  bumpScale(delta: number): void {
    const d = Number(delta);
    if (!Number.isFinite(d) || d === 0) return;
    const next = Math.round((this.scale() + d) * 100) / 100;
    this.setScale(next);
  }

  private clearMoodReset(): void {
    if (this.moodResetTimer == null) return;
    try {
      window.clearTimeout(this.moodResetTimer);
    } catch {
      // ignore
    }
    this.moodResetTimer = null;
  }

  private setMoodTemporary(mood: CompanionMood, ttlMs: number): void {
    const m = String(mood || 'default') as CompanionMood;
    this.mood.set(m);

    const ms = Math.max(0, Math.floor(Number(ttlMs) || 0));
    if (ms <= 0) return;
    this.clearMoodReset();
    this.moodResetTimer = window.setTimeout(() => {
      this.mood.set('default');
    }, ms);
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
        this.pickRandom([...COMPANION_PHRASES.dynamic.pauseLimit.over15]),
        'scold',
        { autoCloseMs: 9000, minIntervalMs: 8 * 60 * 1000 },
      );
      return;
    }

    if (totalSeconds >= limit) {
      this.nudge(
        'tt_pause_hit_15',
        this.pickRandom([...COMPANION_PHRASES.dynamic.pauseLimit.hit15]),
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

  private loadBroadcastList(key: string): BroadcastMsg[] {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return [];
      return arr
        .map((r: any) => this.normalizeBroadcastRow(r))
        .filter((r: BroadcastMsg | null): r is BroadcastMsg => Boolean(r));
    } catch {
      return [];
    }
  }

  private saveBroadcastList(key: string, rows: BroadcastMsg[]): void {
    try {
      localStorage.setItem(key, JSON.stringify(Array.isArray(rows) ? rows : []));
    } catch {
      // ignore
    }
  }

  private normalizeBroadcastRow(row: any): BroadcastMsg | null {
    const id = String(row?.id || '').trim();
    const msg = String(row?.message || '').trim();
    if (!id || !msg) return null;

    return {
      id,
      message: msg,
      kind: String(row?.kind || 'info').trim().toLowerCase(),
      created_at: String(row?.created_at || '').trim(),
      created_by_username: String(row?.created_by_username || '').trim(),
    };
  }

  private pushRecentBroadcast(b: BroadcastMsg): void {
    const prev = this.recentBroadcasts();
    const next = [b, ...prev.filter((x) => x.id !== b.id)].slice(0, 30);
    this.recentBroadcasts.set(next);
    this.saveBroadcastList(LS_RECENT_BROADCASTS, next);
  }

  private pushUnreadBroadcast(b: BroadcastMsg): void {
    const prev = this.unreadBroadcasts();
    if (prev.some((x) => x.id === b.id)) return;
    const next = [...prev, b].slice(-30);
    this.unreadBroadcasts.set(next);
    this.saveBroadcastList(LS_UNREAD_BROADCASTS, next);
  }

  private enqueueBroadcastRow(row: any, opts?: { silent?: boolean }): void {
    const normalized = this.normalizeBroadcastRow(row);
    if (!normalized) return;

    const last = this.getLastBroadcastId();
    if (last && last === normalized.id) return;

    // Update first to dedupe against quick successive events.
    this.setLastBroadcastId(normalized.id);

    // Always keep a recent history (used by "replay last 3").
    this.pushRecentBroadcast(normalized);

    // Voicemail behavior: do not auto-popup; queue as unread.
    if (!opts?.silent) {
      this.pushUnreadBroadcast(normalized);

      // Desktop notification (best-effort; requires browser permission).
      // Only when Noir is enabled, to avoid notifying users who disabled the assistant.
      if (!this.hidden()) {
        const title = this.formatBroadcastTitle(normalized);
        const body = normalized.message.length > 220 ? `${normalized.message.slice(0, 217)}…` : normalized.message;
        this.tryDesktopNotify(`Noir — ${title}`, body, { tag: `tma-broadcast-${normalized.id}`, renotify: true });
      }
    }
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
        this.enqueueBroadcastRow(rows[0]);
        return;
      }

      const newer: any[] = [];
      for (const r of rows) {
        if (String(r?.id || '').trim() === lastId) break;
        newer.push(r);
      }
      if (!newer.length) return;

      newer.reverse();
      for (const r of newer) this.enqueueBroadcastRow(r);
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
        this.enqueueBroadcastRow(row);
      })
      .subscribe((status) => {
        // If the subscription fails, polling still delivers messages.
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          // no-op (avoid spamming UI); polling continues
        }
      });
  }

  private clearBroadcastPlayback(): void {
    if (this.broadcastPlaybackTimer == null) return;
    try {
      window.clearTimeout(this.broadcastPlaybackTimer);
    } catch {
      // ignore
    }
    this.broadcastPlaybackTimer = null;
  }

  private formatBroadcastTitle(b: BroadcastMsg): string {
    const kind = String(b.kind || 'info').trim().toLowerCase();
    const sender = String(b.created_by_username || '').trim();
    const senderSuffix = sender ? `: ${sender}` : '';
    return kind === 'danger'
      ? `Alerta (Admin${senderSuffix})`
      : kind === 'warning'
        ? `Aviso (Admin${senderSuffix})`
        : `Mensagem (Admin${senderSuffix})`;
  }

  private async markBroadcastSeen(id: string): Promise<void> {
    const userId = this.auth.userId();
    if (!userId) return;
    if (!this.sb.ready()) return;

    try {
      await this.sb.supabase.from('broadcast_reads').upsert({
        broadcast_id: id,
        user_id: userId,
        seen_at: new Date().toISOString(),
      });
    } catch {
      // ignore (badge/queue still works even if server write fails)
    }
  }

  private playBroadcast(b: BroadcastMsg, opts?: { autoCloseMs?: number }): void {
    this.speak(b.message, 'simple', {
      title: this.formatBroadcastTitle(b),
      autoCloseMs: Math.max(0, Math.floor(Number(opts?.autoCloseMs) || 16_000)),
      avatar: 'admin-message',
    });
  }

  private playSequence(list: BroadcastMsg[]): void {
    const seq = Array.isArray(list) ? list.filter(Boolean) : [];
    if (!seq.length) return;

    this.clearBroadcastPlayback();
    this.open.set(true);

    const playAt = (i: number) => {
      if (this.hidden()) return;
      if (!this.open()) return;
      const b = seq[i];
      if (!b) return;
      this.playBroadcast(b, { autoCloseMs: 16_000 });
      void this.markBroadcastSeen(b.id);

      if (i + 1 < seq.length) {
        this.broadcastPlaybackTimer = window.setTimeout(() => playAt(i + 1), 16_200);
      }
    };

    playAt(0);
  }

  playUnreadBroadcasts(): void {
    if (this.hidden()) return;

    const unread = this.unreadBroadcasts();
    if (!unread.length) {
      this.toggleOpen();
      return;
    }

    // Consume the unread queue (oldest first).
    this.clearBroadcastPlayback();
    this.open.set(true);

    const playNext = () => {
      if (this.hidden()) return;
      if (!this.open()) return;

      const cur = this.unreadBroadcasts();
      if (!cur.length) return;

      const nextMsg = cur[0];
      const rest = cur.slice(1);
      this.unreadBroadcasts.set(rest);
      this.saveBroadcastList(LS_UNREAD_BROADCASTS, rest);

      this.playBroadcast(nextMsg, { autoCloseMs: 16_000 });
      void this.markBroadcastSeen(nextMsg.id);

      if (rest.length) {
        this.broadcastPlaybackTimer = window.setTimeout(() => playNext(), 16_200);
      }
    };

    playNext();
  }

  playLast3Broadcasts(): void {
    if (this.hidden()) return;
    const recent = this.recentBroadcasts();
    if (!recent.length) return;
    const last3 = recent.slice(0, 3).reverse();
    this.playSequence(last3);
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
    opts?: { title?: string; autoCloseMs?: number; minIntervalMs?: number; mood?: CompanionMood },
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

    if (opts?.mood) {
      const ttl = Math.max(0, Math.floor(Number(opts?.autoCloseMs) || 0)) + 2500;
      this.setMoodTemporary(opts.mood, ttl > 0 ? ttl : 12_000);
    }

    this.speak(text, kind, { title: opts?.title, autoCloseMs: opts?.autoCloseMs });

    try {
      localStorage.setItem(`${LS_NUDGE_PREFIX}${k}`, String(Date.now()));
    } catch {
      // ignore
    }
  }

  imageUrl(): string {
    const st = this.state();

    const mood: CompanionMood = st === 'angry' ? 'angry' : st === 'admin-message' ? 'admin_message' : this.mood();
    const pose: CompanionPose = st === 'idle' || st === 'reading-idle' ? 'idle' : 'speaking';
    const key = `${mood}_${pose}` as CompanionSpriteKey;

    const spriteSet = this.appConfig.sprintModeEnabled() ? COMPANION_SPRITES.sprint : COMPANION_SPRITES.normal;
    const raw =
      spriteSet[key] ||
      COMPANION_SPRITES.normal[key] ||
      COMPANION_SPRITES.normal.default_speaking ||
      'images/Reading-speaking_bg_removed.png.png';

    const path = (() => {
      if (Array.isArray(raw)) {
        const arr = raw.filter(Boolean);
        if (!arr.length) return '';
        const i = pose === 'idle' ? (this.idleSpriteTick() % arr.length) : 0;
        return String(arr[i] || arr[0] || '').trim();
      }
      return String(raw || '').trim();
    })();

    return this.assetUrl(path);
  }

  setHidden(hidden: boolean): void {
    this.hidden.set(Boolean(hidden));
    lsSetBool(LS_HIDDEN, Boolean(hidden));
    if (hidden) {
      this.open.set(false);
      this.manualOpen.set(false);
    }
  }

  close(): void {
    this.open.set(false);
    this.manualOpen.set(false);
    this.clearAutoClose();
    this.clearBroadcastPlayback();
    this.setIdle();
  }

  toggleOpen(): void {
    if (this.hidden()) return;

    // If Noir opened automatically (auto message), a click should reveal controls (not close).
    if (this.open() && !this.manualOpen()) {
      this.manualOpen.set(true);
      return;
    }

    this.open.update((v) => !v);
    if (this.open()) {
      this.manualOpen.set(true);
      // If there are unread admin messages, clicking Noir plays them (voicemail).
      if (this.unreadBroadcastCount() > 0) {
        this.playUnreadBroadcasts();
        return;
      }

      // If the user opens it manually, show a friendly idle line.
      if (!this.text()) {
        this.title.set('Noir');
        this.text.set(this.pickOpenIdleLine());
      }
      if (this.state() === 'idle' || this.state() === 'reading-idle') this.state.set('speaking');
    } else {
      this.manualOpen.set(false);
      this.clearAutoClose();
      this.clearBroadcastPlayback();
      this.setIdle();
    }
  }

  private pickRandom(lines: string[]): string {
    const arr = Array.isArray(lines) ? lines.filter(Boolean) : [];
    if (!arr.length) return '';
    const i = Math.floor(Math.random() * arr.length);
    return String(arr[i] || '').trim();
  }

  private formatTemplate(textRaw: string, tokens: Record<string, string | number>): string {
    let text = String(textRaw || '');
    for (const [k, v] of Object.entries(tokens || {})) {
      const key = String(k || '').trim();
      if (!key) continue;
      text = text.replaceAll(`{${key}}`, String(v ?? ''));
    }
    return text;
  }

  private ctxSnapshot(): CompanionContext {
    const ctx = this.context();
    if (ctx) return ctx;

    return {
      sprint: this.appConfig.sprintModeEnabled(),
      dayPartKey: '',
      quotaDelta: 0,
      withinMarginNow: false,
      predictedOk: false,
      balanceSeconds: 0,
      doneTx: 0,
      remainingUnits: 0,
    };
  }

  private ctxDayPart(keyRaw: string): 'early' | 'mid' | 'late' | 'lunch' | 'post' | 'unknown' {
    const k = String(keyRaw || '').trim().toLowerCase();
    if (!k) return 'unknown';
    if (k === 'post') return 'post';
    if (k.includes('lunch') || k.includes('alm')) return 'lunch';
    if (k.includes('pre') || k.includes('start') || k.includes('early') || k === 'pre') return 'early';
    if (k.includes('late') || k.includes('end')) return 'late';
    if (k.includes('mid')) return 'mid';
    return 'unknown';
  }

  private dialogueContext(): {
    sprint: boolean;
    dayPart: 'early' | 'mid' | 'late' | 'lunch' | 'post' | 'unknown';
    behind: boolean;
    good: boolean;
    late: boolean;
  } {
    const ctx = this.ctxSnapshot();
    const dayPart = this.ctxDayPart(ctx.dayPartKey);
    const late = dayPart === 'late';

    const behind = Number(ctx.quotaDelta) <= -2 || Number(ctx.balanceSeconds) < -10 * 60;
    const good =
      Boolean(ctx.predictedOk) ||
      Boolean(ctx.withinMarginNow) ||
      Number(ctx.quotaDelta) >= 1 ||
      Number(ctx.balanceSeconds) > 8 * 60;

    return { sprint: Boolean(ctx.sprint), dayPart, behind, good, late };
  }

  private pickOpenIdleLine(): string {
    const c = this.dialogueContext();
    const p = COMPANION_PHRASES.dynamic.openIdle;
    const lines = [
      ...(c.sprint ? p.sprint || [] : p.base || []),
      ...(c.late ? p.late || [] : []),
      ...(c.behind ? p.behind || [] : []),
      ...(!c.behind && c.good ? p.good || [] : []),
    ].filter(Boolean);

    const fallback = [...COMPANION_PHRASES.openIdle];
    return this.pickRandom(lines.length ? lines : fallback);
  }

  private normalizeTimerBucket(itemLower: string): string {
    const s = String(itemLower || '').trim().toLowerCase();
    if (!s) return 'default';
    if (s === 'pausa') return 'pausa';
    if (s === 'almoço' || s === 'almoco') return 'almoço';
    if (s === 'falha sistemica' || s === 'falha sistêmica' || s === 'falha_sistemica') return 'falha_sistemica';
    if (s === 'ociosidade') return 'ociosidade';
    if (s === 'processo interno' || s === 'processo_interno') return 'processo_interno';
    if (s === 'daily') return 'daily';
    return 'default';
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

    const bucket = this.normalizeTimerBucket(item);
    const map = COMPANION_PHRASES.dynamic.timeTracker.finish as any;
    const lines = (map[bucket] || map.default || []) as string[];
    const msg = this.formatTemplate(this.pickRandom(lines), { item: raw });

    this.nudge(key, msg, 'simple', { title: 'Noir', autoCloseMs: 9000, minIntervalMs: 2 * 60 * 1000 });
  }

  sayAccountFinish(itemRaw: string, typeRaw: string): void {
    if (this.hidden()) return;

    const item = String(itemRaw || '').trim();
    if (!item) return;

    const type = String(typeRaw || '').trim();
    if (!type || type.toLowerCase() === 'time_tracker') return;

    const key = `acc_finish_${item.toLowerCase()}_${type.toLowerCase()}`;
    const typeLabel = this.typeLabel(type);

    const c = this.dialogueContext();
    const base = c.sprint ? COMPANION_PHRASES.dynamic.account.finish.sprint : COMPANION_PHRASES.dynamic.account.finish.normal;
    const lines = [...base, ...(c.late ? (COMPANION_PHRASES.dynamic.account.finish.late || []) : [])].filter(Boolean);
    const msg = this.formatTemplate(this.pickRandom(lines), { item, type: typeLabel });

    this.nudge(key, msg, 'simple', { title: 'Noir', autoCloseMs: 8500, minIntervalMs: 60 * 1000 });
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
        return this.pickRandom([...COMPANION_PHRASES.dynamic.tma.perfect]);
      }

      if (absDiff >= warnAbsSeconds) {
        if (diffSeconds > 0) {
          return this.pickRandom([...COMPANION_PHRASES.dynamic.tma.warnAbove]);
        }
        return this.pickRandom([...COMPANION_PHRASES.dynamic.tma.warnBelow]);
      }

      // Mid band: gentle coaching.
      if (diffSeconds > 0) {
        return this.pickRandom([...COMPANION_PHRASES.dynamic.tma.midAbove]);
      }
      return this.pickRandom([...COMPANION_PHRASES.dynamic.tma.midBelow]);
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
    const msg = this.pickRandom([
      ...(mode === 'signin'
        ? COMPANION_PHRASES.dynamic.authWelcome.signin
        : COMPANION_PHRASES.dynamic.authWelcome.signup),
    ]);

    this.speak(
      msg,
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

    // Sprint mode should be intense but not punitive.
    if (this.appConfig.sprintModeEnabled() && kind === 'scold') kind = 'simple';

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

    // Auto messages should not show action buttons unless the user has explicitly opened Noir.
    if (!this.manualOpen()) this.manualOpen.set(false);

    const autoCloseMs = Math.max(0, Math.floor(Number(opts?.autoCloseMs) || 0));
    if (autoCloseMs > 0) {
      this.clearAutoClose();
      this.autoCloseTimer = window.setTimeout(() => {
        this.open.set(false);
        this.text.set('');
        // If it was an auto-popup (no manual open), keep actions hidden.
        if (!this.manualOpen()) this.manualOpen.set(false);
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
    this.idleSpriteTick.update((v) => (Number.isFinite(v) ? v + 1 : 1));
  }

  showHelp(): void {
    this.setMoodTemporary('tablet', 22_000);
    this.speak(
      COMPANION_PHRASES.help,
      'complex',
      { title: 'Noir', autoCloseMs: 14000 },
    );
  }

  showTip(): void {
    const c = this.dialogueContext();
    const p = COMPANION_PHRASES.dynamic.tips;
    const lines = [
      ...(c.sprint ? p.sprint || [] : p.base || []),
      ...(c.late ? p.late || [] : []),
      ...(c.behind ? p.behind || [] : []),
    ].filter(Boolean);

    this.speak(
      this.pickRandom(lines.length ? lines : [...COMPANION_PHRASES.tips]),
      'simple',
      { title: 'Dica', autoCloseMs: 8000 },
    );
  }

  showMotivation(): void {
    const c = this.dialogueContext();
    const tone: CompanionTone = (() => {
      if (this.state() === 'angry') return 'angry';
      if (c.behind && c.late) return 'angry';
      if (c.behind) return 'serious';
      if (c.good) return (this.pickRandom(['funny', 'neutral'] as CompanionTone[]) as CompanionTone) || 'neutral';
      return (this.pickRandom(['funny', 'serious', 'neutral'] as CompanionTone[]) as CompanionTone) || 'neutral';
    })();

    this.speak(
      this.pickRandom([...(COMPANION_PHRASES.motivation[tone] || COMPANION_PHRASES.motivation.neutral)]),
      'simple',
      { title: 'Motivação', autoCloseMs: 9000 },
    );
  }

  showShortcuts(): void {
    this.setMoodTemporary('tablet', 22_000);
    this.speak(
      COMPANION_PHRASES.shortcuts,
      'complex',
      { title: 'Atalhos', autoCloseMs: 16000 },
    );
  }

  showTimeTrackerInfo(): void {
    this.setMoodTemporary('tablet', 22_000);
    this.speak(
      COMPANION_PHRASES.timeTrackerInfo,
      'complex',
      { title: 'Time Tracker', autoCloseMs: 17000 },
    );
  }

  sayQuotaBehind(quotaDeltaRaw: number): void {
    const q = Number(quotaDeltaRaw);
    if (!Number.isFinite(q)) return;
    if (q > -2) return;

    this.nudge(
      'quota_behind',
      this.formatTemplate(this.pickRandom([...COMPANION_PHRASES.dynamic.kpis.quotaBehind]), { quotaDelta: q }),
      'simple',
      { autoCloseMs: 6500, minIntervalMs: 18 * 60 * 1000 },
    );
  }

  sayBalanceDrifting(balanceSecondsRaw: number): void {
    const bal = Number(balanceSecondsRaw);
    if (!Number.isFinite(bal)) return;
    if (Math.abs(bal) < 20 * 60) return;

    this.nudge(
      'saldo_far',
      this.pickRandom([...COMPANION_PHRASES.dynamic.kpis.balanceFar]),
      'complex',
      { autoCloseMs: 8000, minIntervalMs: 25 * 60 * 1000 },
    );
  }

  sayWorkdayStarted(): void {
    this.nudge('workday_started', this.pickRandom([...COMPANION_PHRASES.dynamic.kpis.workdayStarted]), 'simple', {
      title: 'Início do dia',
      autoCloseMs: 6500,
      minIntervalMs: 0,
    });
  }

  sayAdminBroadcastSent(): void {
    this.speak(this.pickRandom([...COMPANION_PHRASES.dynamic.admin.broadcastSent]), 'simple', {
      title: 'Admin',
      autoCloseMs: 5000,
    });
  }

  sayMetaHit(): void {
    const c = this.dialogueContext();
    const lines = c.sprint ? COMPANION_PHRASES.dynamic.account.meta17.sprint : COMPANION_PHRASES.dynamic.account.meta17.normal;
    this.nudge(
      'meta_17',
      this.pickRandom([...lines]),
      'simple',
      { title: 'Meta', autoCloseMs: 9500, minIntervalMs: 35 * 60 * 1000, mood: 'congrats' },
    );
  }

  saySprintFastAccount(input: { item: string; type: string; timeSpentSeconds: number }): void {
    if (this.hidden()) return;

    // Only relevant for sprint mode.
    if (!this.appConfig.sprintModeEnabled()) return;

    const item = String(input?.item || '').trim();
    const type = String(input?.type || '').trim();
    const spent = Math.max(0, Math.floor(Number(input?.timeSpentSeconds) || 0));
    if (!item || !type) return;
    if (!Number.isFinite(spent) || spent <= 0) return;
    if (type.toLowerCase() === 'time_tracker') return;

    const fastLimit = 15 * 60;
    if (spent > fastLimit) return;

    const key = `sprint_fast_${item.toLowerCase()}_${type.toLowerCase()}`.replace(/\s+/g, '_');
    this.nudge(
      key,
      this.pickRandom([...COMPANION_PHRASES.dynamic.account.sprintFast]),
      'simple',
      { title: 'Sprint', autoCloseMs: 6500, minIntervalMs: 8 * 60 * 1000, mood: 'congrats' },
    );
  }

  sayStartAccount(action: { item: string; type: string }, opts?: { minIntervalMs?: number }): void {
    const item = String(action?.item || '').trim();
    const type = this.typeLabel(String(action?.type || '').trim());
    if (!item || !type) return;

    const key = `start_${item.toLowerCase()}_${type.toLowerCase()}`.replace(/\s+/g, '_');
    const c = this.dialogueContext();
    const base = c.sprint ? COMPANION_PHRASES.dynamic.account.start.sprint : COMPANION_PHRASES.dynamic.account.start.normal;
    const lines = [
      ...base,
      ...(c.late ? (COMPANION_PHRASES.dynamic.account.start.late || []) : []),
      ...(c.behind ? (COMPANION_PHRASES.dynamic.account.start.behind || []) : []),
    ].filter(Boolean);
    const msg = this.formatTemplate(this.pickRandom(lines), { item, type });
    this.nudge(key, msg, 'simple', {
      title: 'Começou',
      autoCloseMs: 4500,
      minIntervalMs: Math.max(0, Math.floor(Number(opts?.minIntervalMs) || 0)) || 90_000,
    });
  }

  sayLunchStart(source: 'schedule' | 'manual' = 'schedule'): void {
    const title = source === 'manual' ? 'Almoço (TT)' : 'Almoço';
    this.nudge(
      'lunch_start',
      this.pickRandom([...COMPANION_PHRASES.dynamic.lunch.start]),
      'simple',
      { title, autoCloseMs: 9000, minIntervalMs: 20 * 60 * 1000, mood: 'lunch_1' },
    );
  }

  sayLunchBack(source: 'schedule' | 'manual' = 'schedule'): void {
    const title = source === 'manual' ? 'Volta (TT)' : 'Volta do almoço';
    this.nudge(
      'lunch_back',
      this.pickRandom([...COMPANION_PHRASES.dynamic.lunch.back]),
      'simple',
      { title, autoCloseMs: 8500, minIntervalMs: 20 * 60 * 1000, mood: 'lunch_2' },
    );
  }

  sayTimeTrackerStart(itemRaw: string): void {
    const item = String(itemRaw || '').trim();
    if (!item) return;

    const key = `tt_${item.toLowerCase()}`.replace(/\s+/g, '_');
    const title = `TT: ${item}`;

    const bucket = this.normalizeTimerBucket(item.toLowerCase());
    const map = COMPANION_PHRASES.dynamic.timeTracker.start as any;
    const lines = (map[bucket] || map.default || []) as string[];
    const msg = this.formatTemplate(this.pickRandom(lines), { item });

    this.nudge(key, msg, 'simple', { title, autoCloseMs: 9000, minIntervalMs: 6 * 60 * 1000 });
  }

  sayEndOfDaySoon(remainingHuman: string): void {
    const rem = String(remainingHuman || '').trim();
    this.nudge(
      'end_day_soon',
      this.formatTemplate(this.pickRandom([...COMPANION_PHRASES.dynamic.endOfDaySoon]), { remaining: rem }),
      'complex',
      { title: 'Fim do turno', autoCloseMs: 14000, minIntervalMs: 30 * 60 * 1000, mood: 'end_shift' },
    );
  }

  sayShiftEnded(): void {
    this.nudge(
      'shift_ended',
      this.pickRandom([...COMPANION_PHRASES.dynamic.shiftEnded]),
      'simple',
      { title: 'Turno', autoCloseMs: 11000, minIntervalMs: 60 * 60 * 1000, mood: 'end_shift' },
    );
  }

  sayFinishWorkDay(tone: DialogueTone = 'normal'): void {
    const kind: SpeakKind = tone === 'scold' ? 'scold' : 'simple';
    this.speak(
      this.pickRandom([...COMPANION_PHRASES.dynamic.finishWorkDay]),
      kind,
      { title: 'Finalizado', autoCloseMs: 12000 },
    );
  }
}
