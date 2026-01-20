export const SAO_PAULO_TZ = 'America/Sao_Paulo';

export function formatDateTimeSaoPaulo(input: Date | string | null | undefined): string {
  if (!input) return '';
  const d = input instanceof Date ? input : new Date(String(input));
  if (!Number.isFinite(d.getTime())) return '';

  try {
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: SAO_PAULO_TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(d);
  } catch {
    // Fallback: local timezone
    return d.toLocaleString('pt-BR');
  }
}

export function saoPauloDayKey(input: Date | string | null | undefined): string {
  if (!input) return '';
  const d = input instanceof Date ? input : new Date(String(input));
  if (!Number.isFinite(d.getTime())) return '';

  try {
    // en-CA yields YYYY-MM-DD in most environments.
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: SAO_PAULO_TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d);
  } catch {
    // Fallback to local calendar date.
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
}

// NOTE: Brazil currently has no DST; we assume UTC-03:00 for range queries.
// If DST returns, this should be replaced with a timezone-aware conversion.
export function saoPauloDayRangeIsoFromYmd(ymd: string): { startIso: string; endIso: string } {
  const raw = String(ymd || '').trim();
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) {
    const now = new Date();
    const fallback = saoPauloDayKey(now);
    return saoPauloDayRangeIsoFromYmd(fallback);
  }

  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);

  // São Paulo midnight corresponds to 03:00Z.
  const startUtcMs = Date.UTC(y, mo - 1, d, 3, 0, 0, 0);
  const endUtcMs = startUtcMs + 24 * 60 * 60 * 1000;
  return { startIso: new Date(startUtcMs).toISOString(), endIso: new Date(endUtcMs).toISOString() };
}
