export interface PausedWorkEntry {
  id: string;
  item: string;
  type: string;
  tma: number;
  accumulatedSeconds: number;
  updatedAtIso: string;
}

export type PausedWorkStore = Record<string, PausedWorkEntry[]>;

export interface ActiveFlowTimerPersisted {
  key: string;
  start: number; // epoch ms
  baseSeconds: number;
  item: string;
  type: string;
  tma: number;
  savedAtIso?: string;

  // Optional automation (e.g. Almoço auto-stop after 1 hour)
  autoStopAtMs?: number;
}
