import { saoPauloDayKey } from './tz';

/** @deprecated Prefer Brasilia/São Paulo day buckets via `saoPauloDayKey()` */
export function localDayKey(date: Date): string {
  const d = date instanceof Date ? date : new Date(date);
  if (!Number.isFinite(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function brasiliaDayKey(date: Date): string {
  return saoPauloDayKey(date);
}

export function parseLocalDayKeyToDate(dayKey: string): Date | null {
  const raw = String(dayKey || '').trim();
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null;
  if (mo < 1 || mo > 12) return null;
  if (d < 1 || d > 31) return null;
  const out = new Date(y, mo - 1, d);
  return Number.isFinite(out.getTime()) ? out : null;
}

export function isIsoInLocalDay(iso: string, dayKey: string): boolean {
  const rawIso = String(iso || '').trim();
  const key = String(dayKey || '').trim();
  if (!rawIso || !key) return false;
  const d = new Date(rawIso);
  if (!Number.isFinite(d.getTime())) return false;
  return localDayKey(d) === key;
}

export function isIsoInBrasiliaDay(iso: string, dayKey: string): boolean {
  const rawIso = String(iso || '').trim();
  const key = String(dayKey || '').trim();
  if (!rawIso || !key) return false;
  return saoPauloDayKey(rawIso) === key;
}
