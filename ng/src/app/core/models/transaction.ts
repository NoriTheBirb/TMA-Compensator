export type TransactionType = 'conferencia' | 'retorno' | 'time_tracker';
export type TransactionSource = 'modal' | 'flow' | string;

export interface LegacyAssistantInfo {
  lastRecoKey: string;
  lastRecoShownAtIso: string;
  lastRecoAvgDiffTargetSeconds: number;
}

export interface LegacyTransaction {
  /** Cloud primary key when stored in a DB (e.g. Supabase). */
  id?: string;
  /** Cloud created-at timestamp (ISO). */
  createdAtIso?: string;
  item: string;
  type: TransactionType | string;
  tma: number;
  timeSpent: number;
  difference: number;
  creditedMinutes: number;
  timestamp: string;
  source: TransactionSource;
  assistant: LegacyAssistantInfo | null;
}
