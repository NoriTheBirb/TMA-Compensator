import { Injectable } from '@angular/core';

import { STORAGE_KEYS } from './storage-keys';
import type { LegacyTransaction } from '../models/transaction';
import type { ActiveFlowTimerPersisted, PausedWorkEntry, PausedWorkStore } from '../models/paused-work';

export interface LunchWindow {
  start: number;
  end: number;
}

@Injectable({ providedIn: 'root' })
export class StorageService {
  private get ls(): Storage | null {
    try {
      return typeof window !== 'undefined' ? window.localStorage : null;
    } catch {
      return null;
    }
  }

  getBalanceSeconds(): number {
    const v = this.ls?.getItem(STORAGE_KEYS.balance);
    const parsed = v ? parseInt(v, 10) : 0;
    return Number.isFinite(parsed) ? parsed : 0;
  }

  setBalanceSeconds(value: number): void {
    this.ls?.setItem(STORAGE_KEYS.balance, String(Math.floor(Number(value) || 0)));
  }

  getTransactions(): LegacyTransaction[] {
    const raw = this.ls?.getItem(STORAGE_KEYS.transactions);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as LegacyTransaction[]) : [];
    } catch {
      return [];
    }
  }

  setTransactions(value: LegacyTransaction[]): void {
    this.ls?.setItem(STORAGE_KEYS.transactions, JSON.stringify(Array.isArray(value) ? value : []));
  }

  getLastRegisteredAtMsOrNull(): number | null {
    const raw = this.ls?.getItem(STORAGE_KEYS.lastRegisteredAtMs);
    if (raw === null || raw === undefined) return null;
    if (String(raw).trim() === '') return null;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return Math.floor(parsed);
  }

  setLastRegisteredAtMs(value: number): void {
    const ms = Math.floor(Number(value) || 0);
    if (!Number.isFinite(ms) || ms <= 0) return;
    this.ls?.setItem(STORAGE_KEYS.lastRegisteredAtMs, String(ms));
  }

  getDarkThemeEnabled(): boolean {
    return this.ls?.getItem(STORAGE_KEYS.darkTheme) === '1';
  }

  setDarkThemeEnabled(enabled: boolean): void {
    this.ls?.setItem(STORAGE_KEYS.darkTheme, enabled ? '1' : '0');
  }

  getShowComplexa(): boolean {
    return this.ls?.getItem(STORAGE_KEYS.showComplexa) === '1';
  }

  setShowComplexa(enabled: boolean): void {
    this.ls?.setItem(STORAGE_KEYS.showComplexa, enabled ? '1' : '0');
  }

  getShiftStartSecondsOrNull(): number | null {
    const raw = this.ls?.getItem(STORAGE_KEYS.shiftStart);
    if (raw === null || raw === undefined) return null;
    if (String(raw).trim() === '') return null;
    const parsed = parseInt(String(raw), 10);
    return Number.isFinite(parsed) ? parsed : null;
  }

  setShiftStartSeconds(value: number): void {
    this.ls?.setItem(STORAGE_KEYS.shiftStart, String(Math.floor(Number(value) || 0)));
  }

  getLunchWindowOrNull(): LunchWindow | null {
    const raw = this.ls?.getItem(STORAGE_KEYS.lunch);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      const start = Math.floor(Number(parsed?.start));
      const end = Math.floor(Number(parsed?.end));
      if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
      return { start, end };
    } catch {
      return null;
    }
  }

  setLunchWindow(window: LunchWindow): void {
    this.ls?.setItem(
      STORAGE_KEYS.lunch,
      JSON.stringify({
        start: Math.floor(Number(window?.start) || 0),
        end: Math.floor(Number(window?.end) || 0),
      }),
    );
  }

  getLunchStyleEnabled(): boolean {
    const raw = this.ls?.getItem(STORAGE_KEYS.lunchStyle) ?? null;
    if (raw === null) return true;
    try {
      return Boolean(JSON.parse(raw));
    } catch {
      return true;
    }
  }

  setLunchStyleEnabled(enabled: boolean): void {
    this.ls?.setItem(STORAGE_KEYS.lunchStyle, JSON.stringify(enabled));
  }

  getFlowModeEnabled(): boolean {
    return this.ls?.getItem(STORAGE_KEYS.flowMode) === '1';
  }

  setFlowModeEnabled(enabled: boolean): void {
    this.ls?.setItem(STORAGE_KEYS.flowMode, enabled ? '1' : '0');
  }

  getAnalyticsRaw(): any {
    const raw = this.ls?.getItem(STORAGE_KEYS.analytics);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  setAnalyticsRaw(value: any): void {
    try {
      this.ls?.setItem(STORAGE_KEYS.analytics, JSON.stringify(value ?? null));
    } catch {
      // ignore
    }
  }

  getPausedWorkStore(): PausedWorkStore {
    const raw = this.ls?.getItem(STORAGE_KEYS.pausedWork);
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw);
      return this.normalizePausedWorkStore(parsed);
    } catch {
      return {};
    }
  }

  setPausedWorkStore(store: PausedWorkStore): void {
    const normalized = this.normalizePausedWorkStore(store);
    this.ls?.setItem(STORAGE_KEYS.pausedWork, JSON.stringify(normalized || {}));
  }

  getActiveFlowTimerOrNull(): ActiveFlowTimerPersisted | null {
    const raw = this.ls?.getItem(STORAGE_KEYS.activeFlowTimer);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      const key = String(parsed?.key || '');
      const start = Number(parsed?.start);
      const baseSeconds = Math.max(0, Math.floor(Number(parsed?.baseSeconds) || 0));
      const item = String(parsed?.item || '');
      const type = String(parsed?.type || '');
      const tma = Math.max(0, Math.floor(Number(parsed?.tma) || 0));
      const savedAtIso = parsed?.savedAtIso ? String(parsed.savedAtIso) : undefined;
      const autoStopAtMsRaw = parsed?.autoStopAtMs;
      const autoStopAtMs = autoStopAtMsRaw === undefined || autoStopAtMsRaw === null ? undefined : Number(autoStopAtMsRaw);
      if (!key || !Number.isFinite(start) || start <= 0) return null;
      if (!item || !type) return null;

      const out: ActiveFlowTimerPersisted = { key, start, baseSeconds, item, type, tma, savedAtIso };
      if (Number.isFinite(autoStopAtMs) && (autoStopAtMs as number) > 0) out.autoStopAtMs = autoStopAtMs as number;
      return out;
    } catch {
      return null;
    }
  }

  setActiveFlowTimer(value: ActiveFlowTimerPersisted): void {
    const payload: ActiveFlowTimerPersisted = {
      key: String(value?.key || ''),
      start: Number(value?.start) || 0,
      baseSeconds: Math.max(0, Math.floor(Number(value?.baseSeconds) || 0)),
      item: String(value?.item || ''),
      type: String(value?.type || ''),
      tma: Math.max(0, Math.floor(Number(value?.tma) || 0)),
      savedAtIso: value?.savedAtIso ? String(value.savedAtIso) : new Date().toISOString(),
    };

    const autoStopAtMs = value?.autoStopAtMs;
    if (Number.isFinite(Number(autoStopAtMs)) && Number(autoStopAtMs) > 0) {
      payload.autoStopAtMs = Number(autoStopAtMs);
    }
    if (!payload.key || !Number.isFinite(payload.start) || payload.start <= 0) return;
    this.ls?.setItem(STORAGE_KEYS.activeFlowTimer, JSON.stringify(payload));
  }

  clearActiveFlowTimer(): void {
    try {
      this.ls?.removeItem(STORAGE_KEYS.activeFlowTimer);
    } catch {
      // ignore
    }
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
}
