export type AnalyticsGuideMode = 'conservative' | 'aggressive';

export interface AnalyticsEvent {
  type: string;
  tsIso: string;
  currentSeconds: number;
  realSeconds: number;
  debugTimeSeconds: number | null;
  flowMode: boolean;
  isLunch: boolean;
  data: any;
}

export interface AnalyticsState {
  schemaVersion: number;
  sessionId: string;
  createdAtIso: string;
  lastUpdatedAtIso: string;
  settings: {
    dailyQuota: number;
    balanceMarginSeconds: number;
    shiftStartSeconds: number;
    shiftEndSeconds: number;
  };
  counters: {
    txAdded: number;
    txDeleted: number;
    resetAll: number;
    endDayExport: number;
  };
  assistant: {
    detailsOpens: number;
    detailsCloses: number;
    recommendationsShown: number;
    recommendationsFollowed: number;
    perType: Record<string, { shown: number; followed: number }>;
    lastRecoSig: string | null;
    lastReco: any;
  };
  flow: {
    modeEnabledCount: number;
    modeDisabledCount: number;
    timerStarts: number;
    timerStops: number;
    blockedStartOther: number;
    blockedLeaveWithRunning: number;
  };
  lunch: {
    configuredCount: number;
  };
  debug: {
    setDebugTimeCount: number;
    resetDebugTimeCount: number;
    simStartCount: number;
    simPauseCount: number;
    simResetCount: number;
  };
  ui: {
    assistantSimplified: boolean;
  };
  eventLog: AnalyticsEvent[];
}
