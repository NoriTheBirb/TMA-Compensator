export function quotaWeightForItem(item: string): number {
  const it = String(item || '').trim();

  // Time Tracker categories should not count toward production quota.
  if (
    it === 'Pausa' ||
    it === 'Almoço' ||
    it === 'Falha sistemica' ||
    it === 'Falha sistêmica' ||
    it === 'Ociosidade' ||
    it === 'Ociosidade involuntaria' ||
    it === 'Ociosidade involuntária' ||
    it === 'Processo interno' ||
    it === 'Daily' ||
    it === 'Time Tracker'
  ) {
    return 0;
  }

  return it === 'Complexa' ? 2 : 1;
}
