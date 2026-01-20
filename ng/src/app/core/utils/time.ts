export function secondsToTime(totalSeconds: number): string {
  const abs = Math.max(0, Math.floor(Math.abs(Number(totalSeconds) || 0)));
  const hours = Math.floor(abs / 3600);
  const minutes = Math.floor((abs % 3600) / 60);
  const seconds = abs % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function secondsToClockHHMM(totalSeconds: number): string {
  const sec = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const hours = Math.floor(sec / 3600) % 24;
  const minutes = Math.floor((sec % 3600) / 60);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

export function durationToHHMM(totalSeconds: number): string {
  const sec = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const hours = Math.floor(sec / 3600);
  const minutes = Math.floor((sec % 3600) / 60);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

export function secondsToHuman(totalSeconds: number): string {
  const sec = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  if (sec < 60) return `${sec}s`;
  const minutes = Math.floor(sec / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remMin = minutes % 60;
  return remMin ? `${hours}h ${remMin}m` : `${hours}h`;
}

// Parses "HH:MM" into seconds since 00:00.
export function parseClockHHMMToSeconds(rawInput: string): number | null {
  const raw = String(rawInput || '').trim();
  const m = raw.match(/^\s*(\d{1,2})\s*:\s*(\d{2})\s*$/);
  if (!m) return null;
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  if (hours < 0 || hours > 23) return null;
  if (minutes < 0 || minutes > 59) return null;
  return Math.floor(hours * 3600 + minutes * 60);
}

// Parses "HH:MM:SS" (or "HH:MM") into seconds since 00:00.
export function parseClockHHMMSSToSeconds(rawInput: string): number | null {
  const raw = String(rawInput || '').trim();
  if (!raw) return null;
  const m = raw.match(/^\s*(\d{1,2})\s*:\s*(\d{2})(?:\s*:\s*(\d{2}))?\s*$/);
  if (!m) return null;
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  const seconds = m[3] !== undefined ? Number(m[3]) : 0;
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || !Number.isFinite(seconds)) return null;
  if (hours < 0 || hours > 23) return null;
  if (minutes < 0 || minutes > 59) return null;
  if (seconds < 0 || seconds > 59) return null;
  return Math.floor(hours * 3600 + minutes * 60 + seconds);
}

export function formatSignedTime(totalSeconds: number): string {
  const sec = Math.floor(Number(totalSeconds) || 0);
  const sign = sec > 0 ? '+' : sec < 0 ? '-' : '';
  return `${sign}${secondsToTime(sec)}`;
}

// Duration parser (legacy-friendly):
// - "12" => 12 minutes
// - "MM:SS" (two parts)
// - "HH:MM:SS" (three parts)
export function timeToSeconds(rawInput: string): number | null {
  const raw = String(rawInput || '').trim();
  if (!raw) return null;

  if (/^\d+$/.test(raw)) {
    const minutes = Number(raw);
    if (!Number.isFinite(minutes) || minutes < 0) return null;
    return Math.floor(minutes * 60);
  }

  const parts = raw.split(':').map(p => p.trim());
  if (parts.length !== 2 && parts.length !== 3) return null;

  // Two parts are treated as MM:SS (duration).
  // For hours, require three-part format HH:MM:SS.
  const [aStr, bStr, cStr] = parts;
  const hours = parts.length === 3 ? Number(aStr) : 0;
  const minutes = parts.length === 3 ? Number(bStr) : Number(aStr);
  const seconds = parts.length === 3 ? Number(cStr) : Number(bStr);

  if (![hours, minutes, seconds].every(n => Number.isFinite(n))) return null;
  if (hours < 0 || minutes < 0 || seconds < 0) return null;
  if (minutes > 59 && parts.length === 3) return null;
  if (seconds > 59) return null;

  return Math.floor(hours * 3600 + minutes * 60 + seconds);
}
