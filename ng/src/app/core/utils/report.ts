/*
  Ported from legacy ScriptPage2.js (Report page).
  Goal: preserve behavior/output while keeping it framework-friendly.
*/

export interface LunchWindowLike {
  start: number;
  end: number;
}

export interface ReportDataset {
  darkThemeEnabled: boolean;
  balanceSeconds: number;
  transactions: any[];
  lunch: LunchWindowLike | null;
  shiftStartSeconds: number;
  showComplexa: boolean;
  pausedWork: any;
}

export function safeParseJson(raw: string | null, fallback: any) {
  try {
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function escapeHtml(str: unknown): string {
  return String(str ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export function secondsToTime(seconds: unknown): string {
  const s = Math.round(Number(seconds) || 0);
  const sign = s < 0 ? '-' : '';
  const abs = Math.abs(s);
  const hh = Math.floor(abs / 3600);
  const mm = Math.floor((abs % 3600) / 60);
  const ss = abs % 60;
  return sign + String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0') + ':' + String(ss).padStart(2, '0');
}

export function secondsToShort(seconds: unknown): string {
  const abs = Math.max(0, Math.floor(Math.abs(Number(seconds) || 0)));
  const m = Math.floor(abs / 60);
  const s = abs % 60;
  if (m <= 0) return `${s}s`;
  return `${m}m${String(s).padStart(2, '0')}s`;
}

export function secondsToHuman(seconds: unknown): string {
  const abs = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(abs / 3600);
  const m = Math.floor((abs % 3600) / 60);
  if (h <= 0) return `${m}m`;
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

export function formatSigned(seconds: unknown): string {
  const s = Math.round(Number(seconds) || 0);
  const sign = s > 0 ? '+' : s < 0 ? '-' : '';
  return sign + secondsToTime(Math.abs(s));
}

export function formatSignedCompact(seconds: unknown): string {
  const s = Math.round(Number(seconds) || 0);
  const sign = s > 0 ? '+' : s < 0 ? '-' : '';
  return sign + secondsToShort(Math.abs(s));
}

export function clockFromSeconds(seconds: unknown): string {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const hh = Math.floor(s / 3600) % 24;
  const mm = Math.floor((s % 3600) / 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

export function groupBy<T>(arr: T[], keyFn: (t: T) => string): Map<string, number> {
  const map = new Map<string, number>();
  for (const item of arr || []) {
    const k = keyFn(item);
    map.set(k, (map.get(k) || 0) + 1);
  }
  return map;
}

export function computeTxStats(transactions: any[]) {
  const list = Array.isArray(transactions) ? transactions : [];
  const count = list.length;
  const sumDiff = list.reduce((acc, t) => acc + (Number((t as any)?.difference) || 0), 0);
  const avgDiff = count ? Math.round(sumDiff / count) : 0;
  const sumTimeSpent = list.reduce((acc, t) => acc + (Number((t as any)?.timeSpent) || 0), 0);

  const itemCounts = groupBy(list, t => String((t as any)?.item || '—'));
  const topItems = Array.from(itemCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);

  return {
    count,
    sumDiff,
    avgDiff,
    sumTimeSpent,
    topItems,
  };
}

export function normalizePausedWorkStore(store: any): Record<string, Array<any>> {
  const out: Record<string, Array<any>> = {};
  if (!store || typeof store !== 'object') return out;

  for (const [key, value] of Object.entries(store)) {
    if (!key) continue;
    if (Array.isArray(value)) {
      out[key] = (value as any[])
        .filter(Boolean)
        .map(v => ({
          id: String((v as any)?.id || ''),
          item: String((v as any)?.item || ''),
          type: String((v as any)?.type || ''),
          tma: Number((v as any)?.tma) || 0,
          accumulatedSeconds: Math.max(0, Math.floor(Number((v as any)?.accumulatedSeconds) || 0)),
          updatedAtIso: String((v as any)?.updatedAtIso || ''),
        }))
        .filter(v => v.item && v.type && v.accumulatedSeconds > 0);
    } else if (value && typeof value === 'object') {
      const v = value as any;
      out[key] = [
        {
          id: String(v?.id || ''),
          item: String(v?.item || ''),
          type: String(v?.type || ''),
          tma: Number(v?.tma) || 0,
          accumulatedSeconds: Math.max(0, Math.floor(Number(v?.accumulatedSeconds) || 0)),
          updatedAtIso: String(v?.updatedAtIso || ''),
        },
      ].filter(x => x.item && x.type && x.accumulatedSeconds > 0);
    }
  }

  return out;
}

export function buildBarList(title: string, entries: Array<[string, number]>): string {
  if (!entries.length) {
    return `<div class="report-muted">Nada ainda.</div>`;
  }

  const max = Math.max(...entries.map(([, v]) => v));
  const rows = entries
    .map(([label, value]) => {
      const pct = max ? Math.round((value / max) * 100) : 0;
      return `
        <div class="report-bar-row">
          <div class="report-bar-label">${escapeHtml(label)}</div>
          <div class="report-bar-track" aria-hidden="true">
            <div class="report-bar-fill" style="width:${pct}%;"></div>
          </div>
          <div class="report-bar-value">${value}</div>
        </div>
      `;
    })
    .join('');

  return `
    <div class="report-subtitle">${escapeHtml(title)}</div>
    <div class="report-bar-list">${rows}</div>
  `;
}

export function parseTxDate(value: any): Date | null {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;

  const d1 = new Date(value);
  if (!Number.isNaN(d1.getTime())) return d1;

  const s = String(value).trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:,|\s)+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (m) {
    const dd = Number(m[1]);
    const mm = Number(m[2]);
    const yyyy = Number(m[3]);
    const hh = Number(m[4]);
    const min = Number(m[5]);
    const ss = Number(m[6] || 0);
    const d2 = new Date(yyyy, mm - 1, dd, hh, min, ss);
    if (!Number.isNaN(d2.getTime())) return d2;
  }

  return null;
}

export function classifyDaypartByHour(h: unknown) {
  const hour = Number(h);
  if (!Number.isFinite(hour)) return { key: 'unknown', label: 'Sem horário', range: '—' };
  if (hour >= 6 && hour < 12) return { key: 'morning', label: 'Manhã', range: '06–12' };
  if (hour >= 12 && hour < 18) return { key: 'afternoon', label: 'Tarde', range: '12–18' };
  if (hour >= 18 && hour < 24) return { key: 'evening', label: 'Noite', range: '18–24' };
  return { key: 'night', label: 'Madrugada', range: '00–06' };
}

export function scoreToneFromAbsDiff(absDiffSeconds: unknown): 'good' | 'warn' | 'bad' {
  const s = Math.abs(Number(absDiffSeconds) || 0);
  if (s <= 60) return 'good';
  if (s <= 180) return 'warn';
  return 'bad';
}

function dataAttr(title: string, body: string): string {
  const safeTitle = escapeHtml(title);
  const safeBody = encodeURIComponent(String(body || ''));
  return `data-modal-title="${safeTitle}" data-modal-body="${safeBody}"`;
}

export function renderAwardsAndDaypartsHtml(input: {
  transactions: any[];
  balanceSeconds: number;
  lunchWindow: LunchWindowLike | null;
  showLocked: boolean;
}): { awardsHtml: string; daypartsHtml: string } {
  const tx = Array.isArray(input.transactions) ? input.transactions : [];
  if (!tx.length) {
    return {
      awardsHtml: `<div class="report-muted">Sem awards ainda — precisa de histórico.</div>`,
      daypartsHtml: `<div class="report-muted">Sem dados por horário ainda.</div>`,
    };
  }

  // Dayparts
  const buckets = new Map<string, any>();
  const orderedKeys = ['morning', 'afternoon', 'evening', 'night', 'unknown'];
  for (const t of tx) {
    const dt = parseTxDate((t as any)?.timestamp);
    const part = classifyDaypartByHour(dt ? dt.getHours() : Number.NaN);
    const key = part.key;
    if (!buckets.has(key)) {
      buckets.set(key, {
        ...part,
        count: 0,
        sumSpent: 0,
        sumDiff: 0,
        underCount: 0,
      });
    }
    const b = buckets.get(key);
    const spent = Number((t as any)?.timeSpent) || 0;
    const diff = Number((t as any)?.difference) || 0;
    b.count += 1;
    b.sumSpent += spent;
    b.sumDiff += diff;
    if (diff <= 0) b.underCount += 1;
  }

  const bucketList = orderedKeys
    .map(k => buckets.get(k))
    .filter(Boolean)
    .filter((b: any) => b.count > 0);

  let bestBucket: any = null;
  let worstBucket: any = null;
  for (const b of bucketList) {
    const avgSpent = b.sumSpent / Math.max(1, b.count);
    if (!bestBucket || avgSpent < bestBucket.sumSpent / bestBucket.count) bestBucket = b;
    if (!worstBucket || avgSpent > worstBucket.sumSpent / worstBucket.count) worstBucket = b;
  }

  const daypartRows: string[] = [];
  for (const b of bucketList) {
    const avgSpent = b.sumSpent / Math.max(1, b.count);
    const avgDiff = b.sumDiff / Math.max(1, b.count);
    const pctUnder = Math.round((b.underCount / Math.max(1, b.count)) * 100);
    const tone = scoreToneFromAbsDiff(Math.abs(avgDiff));
    const badge =
      tone === 'good' ? 'Perto de 0 (bom)' : tone === 'warn' ? 'Oscilando (ok)' : 'Longe de 0 (atenção)';

    const details = [
      `Como eu separo por horário:`,
      `- Eu leio o campo “Quando” (timestamp) de cada conta`,
      `- Classifico pelo horário local: Manhã (06–12), Tarde (12–18), Noite (18–24), Madrugada (00–06)`,
      ``,
      `O que significa cada número:`,
      `- média gasto = média do tempo gasto (timeSpent) nesse bloco`,
      `- média (Gasto - TMA) = média da diferença; negativo é bom`,
      `- % ≤ TMA = % de contas com (Gasto - TMA) ≤ 0`,
      ``,
      `Metas (referência):`,
      `- Meta do dia: 17 contas`,
      `- Saldo bom: perto de 00:00:00`,
    ].join('\n');

    daypartRows.push(`
      <div class="daypart-row is-clickable" role="button" tabindex="0" ${dataAttr(`Momento do dia — ${b.label}`, details)}>
        <div class="daypart-main">
          <div class="daypart-title">${escapeHtml(b.label)} <span class="report-pill ${tone}" style="margin-left:8px;">${escapeHtml(badge)}</span></div>
          <div class="daypart-sub">${escapeHtml(b.range)} • ${b.count} contas • média gasto: <b>${escapeHtml(secondsToShort(avgSpent))}</b> • média (Gasto - TMA): <b>${escapeHtml(formatSignedCompact(avgDiff))}</b> • ${pctUnder}% ≤ TMA</div>
        </div>
        <div class="daypart-score">${escapeHtml(secondsToShort(avgSpent))}</div>
      </div>
    `);
  }

  let daypartsHeader = '';
  if (bestBucket && worstBucket && bestBucket.key !== worstBucket.key) {
    const bestAvg = bestBucket.sumSpent / bestBucket.count;
    const worstAvg = worstBucket.sumSpent / worstBucket.count;
    daypartsHeader = `
      <div class="report-item" style="margin-bottom:10px;">
        <div class="report-pill warn">Resumo</div>
        <p>Melhor momento: <b>${escapeHtml(bestBucket.label)}</b> (${escapeHtml(secondsToShort(bestAvg))} em média). Mais difícil: <b>${escapeHtml(worstBucket.label)}</b> (${escapeHtml(secondsToShort(worstAvg))} em média).</p>
      </div>
    `;
  }

  const daypartsHtml = `${daypartsHeader}<div class="report-dayparts">${daypartRows.join('')}</div>`;

  // Awards
  const diffsList = tx.map(t => Number((t as any)?.difference)).filter((n: number) => Number.isFinite(n));
  const absDiffs = diffsList.map(d => Math.abs(d));
  const sumDiff = diffsList.reduce((a, b) => a + b, 0);
  const avgDiff = sumDiff / Math.max(1, diffsList.length);
  const avgAbsDiff = absDiffs.reduce((a, b) => a + b, 0) / Math.max(1, absDiffs.length);
  const maxAbsDiff = absDiffs.length ? Math.max(...absDiffs) : 0;

  const sortedAbs = absDiffs.slice().sort((a, b) => a - b);
  const p90Abs = sortedAbs.length ? sortedAbs[Math.min(sortedAbs.length - 1, Math.floor(sortedAbs.length * 0.9))] : 0;

  const countNear20s = absDiffs.filter(s => s <= 20).length;
  const countNear60s = absDiffs.filter(s => s <= 60).length;
  const pctNear20s = Math.round((countNear20s / Math.max(1, absDiffs.length)) * 100);
  const pctNear60s = Math.round((countNear60s / Math.max(1, absDiffs.length)) * 100);

  const saldo = Number.isFinite(Number(input.balanceSeconds)) ? Number(input.balanceSeconds) : sumDiff;
  const absSaldo = Math.abs(saldo);

  const lunch = input.lunchWindow && typeof input.lunchWindow === 'object' ? input.lunchWindow : null;
  const hasLunchWindow = Boolean(lunch && Number.isFinite(lunch.start) && Number.isFinite(lunch.end) && lunch.start !== lunch.end);
  const isSecondsInWindow = (sec: number, start: number, end: number) => {
    if (!Number.isFinite(sec) || !Number.isFinite(start) || !Number.isFinite(end)) return false;
    if (start < end) return sec >= start && sec <= end;
    return sec >= start || sec <= end;
  };
  const anyTxDuringLunch =
    hasLunchWindow &&
    tx.some(t => {
      const dt = parseTxDate((t as any)?.timestamp);
      if (!dt) return false;
      const sec = dt.getHours() * 3600 + dt.getMinutes() * 60 + dt.getSeconds();
      return isSecondsInWindow(sec, Number((lunch as any).start), Number((lunch as any).end));
    });

  const BALANCE_MARGIN_SECONDS = 10 * 60;

  let nearStreak = 0;
  for (const t of tx) {
    const d = Number((t as any)?.difference);
    if (!Number.isFinite(d)) break;
    if (Math.abs(d) <= 60) nearStreak += 1;
    else break;
  }

  const dates = tx.map(t => parseTxDate((t as any)?.timestamp)).filter(Boolean) as Date[];
  const earliest = dates.length ? new Date(Math.min(...dates.map(d => d.getTime()))) : null;
  const latest = dates.length ? new Date(Math.max(...dates.map(d => d.getTime()))) : null;
  const latestHour = latest ? latest.getHours() : null;

  const txOldestFirst = dates.length
    ? tx
        .slice()
        .sort((a, b) => {
          const da = parseTxDate((a as any)?.timestamp);
          const db = parseTxDate((b as any)?.timestamp);
          return (da ? da.getTime() : 0) - (db ? db.getTime() : 0);
        })
    : tx.slice().reverse();

  const returnCount = tx.filter(t => String((t as any)?.type || '').toLowerCase() === 'retorno').length;
  const returnPct = Math.round((returnCount / Math.max(1, tx.length)) * 100);
  const complexCount = tx.filter(t => String((t as any)?.item || '') === 'Complexa').length;
  const hasExactTma = diffsList.some(d => d === 0);

  // Episodes out of margin
  let running = 0;
  let outEpisodes = 0;
  let everOutOfMargin = false;
  let wasOut = false;
  for (const t of txOldestFirst) {
    const d = Number((t as any)?.difference);
    if (!Number.isFinite(d)) continue;
    running += d;
    const isOut = Math.abs(running) > BALANCE_MARGIN_SECONDS;
    if (isOut && !wasOut) outEpisodes += 1;
    if (isOut) everOutOfMargin = true;
    wasOut = isOut;
  }
  const endedWithinMargin = absSaldo <= BALANCE_MARGIN_SECONDS;
  const first10 = txOldestFirst.slice(0, 10);
  const last10 = txOldestFirst.slice(-10);
  const avgAbsFirst10 = first10.reduce((a, t) => a + Math.abs(Number((t as any)?.difference) || 0), 0) / Math.max(1, first10.length);
  const avgAbsLast10 = last10.reduce((a, t) => a + Math.abs(Number((t as any)?.difference) || 0), 0) / Math.max(1, last10.length);
  const comebackAbsGain = avgAbsFirst10 > 0 && avgAbsLast10 > 0 ? avgAbsFirst10 - avgAbsLast10 : 0;

  let closestTx: any = null;
  for (const t of tx) {
    const d = Number((t as any)?.difference);
    if (!Number.isFinite(d)) continue;
    const ad = Math.abs(d);
    if (!closestTx || ad < Math.abs(Number((closestTx as any)?.difference) || 0)) closestTx = t;
  }

  const awards: Array<{ icon: string; title: string; desc: string; details: string; locked: boolean }> = [];
  const addAward = (icon: string, title: string, desc: string, details: string, locked = false) =>
    awards.push({ icon, title, desc, details, locked });
  const lockHint = (how: string) => `Bloqueado — ${how}`;

  if (tx.length >= 17) {
    addAward('🎯', 'Bateu a meta', `Você fez ${tx.length} contas hoje (meta: 17).`, `Condição: registrar 17+ contas no dia.\n\nPor que isso existe:\n- A meta é volume diário (não minutos).`);
  } else {
    addAward('🎯', 'Bateu a meta', lockHint('registre 17 contas no dia'), `Como desbloquear:\n- Registre 17 contas no dia.\n\nDica:\n- Você está em ${tx.length}/17 hoje.`, true);
  }

  if (hasExactTma) {
    addAward('🧷', 'Na risca', 'Você fez pelo menos 1 conta exatamente no TMA.', `Condição:\n- Ter pelo menos 1 conta com (Gasto - TMA) = 0.`);
  } else {
    addAward('🧷', 'Na risca', lockHint('faça 1 conta com (Gasto - TMA) = 0'), `Como desbloquear:\n- Ter pelo menos 1 conta com (Gasto - TMA) = 0.`, true);
  }

  if (endedWithinMargin) {
    addAward('🏦', 'Dentro da margem', `Você fechou o dia dentro de ±10 min (${formatSignedCompact(saldo)}).`, `Condição:\n- Fechar o dia com |saldo| ≤ 10 min.`);
  } else {
    addAward('🏦', 'Dentro da margem', lockHint('feche o dia dentro de ±10 min'), `Como desbloquear:\n- Fechar o dia com |saldo| ≤ 10 min.\n\nSaldo atual: ${formatSignedCompact(saldo)}.`, true);
  }

  if (tx.length >= 17 && endedWithinMargin) {
    addAward('🏅', 'Conquista de honra', 'Bateu a meta e fechou o dia dentro da margem.', `Condição:\n- 17+ contas\n- E fechar o dia com |saldo| ≤ 10 min.`);
  } else {
    addAward('🏅', 'Conquista de honra', lockHint('faça 17 contas e feche dentro de ±10 min'), `Como desbloquear:\n- 17+ contas\n- E fechar o dia com |saldo| ≤ 10 min.`, true);
  }

  if (everOutOfMargin && endedWithinMargin) {
    addAward('⚡', 'Recuperação rápida', 'Saiu da margem, mas fechou o dia dentro da meta.', `Condição:\n- Em algum momento, o saldo ficou fora de ±10 min\n- E fechou o dia com |saldo| ≤ 10 min.`);
  } else {
    addAward('⚡', 'Recuperação rápida', lockHint('saia da margem e termine dentro de ±10 min'), `Como desbloquear:\n- Em algum momento, o saldo precisa passar de ±10 min\n- E no final do dia, |saldo| ≤ 10 min.`, true);
  }

  if (outEpisodes >= 5 && endedWithinMargin) {
    addAward('🔥', 'Brincando com fogo', `Você saiu da margem de ±10 min ${outEpisodes} vezes e terminou dentro.`, `Condição:\n- Sair da margem de ±10 min 5+ vezes (episódios)\n- E fechar o dia com |saldo| ≤ 10 min.`);
  } else {
    addAward('🔥', 'Brincando com fogo', lockHint('saia da margem 5 vezes e feche dentro de ±10 min'), `Como desbloquear:\n- Sair da margem de ±10 min 5+ vezes\n- E fechar o dia com |saldo| ≤ 10 min.`, true);
  }

  if (!everOutOfMargin) {
    addAward('🧼', 'Perfeccionista', 'Você não deixou o saldo passar da margem de ±10 min nenhuma vez.', `Condição:\n- Em nenhum momento o saldo acumulado passou de ±10 min.\n\nComo eu verifico:\n- Eu somo (Gasto - TMA) conta por conta (do mais antigo ao mais novo) e observo o saldo acumulado.`);
  } else {
    addAward('🧼', 'Perfeccionista', lockHint('não deixe o saldo acumulado passar de ±10 min'), `Como desbloquear:\n- Não deixe o saldo acumulado passar de ±10 min em nenhum momento.\n\nDica:\n- Se você estourou a margem cedo, a chance de estourar de novo aumenta.`, true);
  }

  if (complexCount >= 10) {
    addAward('🧱', '10 complexas', `Você fez ${complexCount} contas Complexas.`, `Condição:\n- Fazer 10+ contas com item = "Complexa".`);
  } else {
    addAward('🧱', '10 complexas', lockHint('faça 10 contas Complexas'), `Como desbloquear:\n- Fazer 10+ contas com item = "Complexa".`, true);
  }

  if (tx.length >= 17 && returnCount === 0) {
    addAward('🚫', 'Retorno? Pra que?', 'Bateu a meta sem nenhum retorno.', `Condição:\n- 17+ contas\n- E 0 contas do tipo "retorno".`);
  } else {
    addAward('🚫', 'Retorno? Pra que?', lockHint('bata a meta sem retornos'), `Como desbloquear:\n- 17+ contas\n- E 0 contas do tipo "retorno".`, true);
  }

  if (returnCount === 0) {
    addAward('🙅', 'Retorno? Hoje não', 'Você não fez nenhum retorno hoje.', `Condição:\n- Ter 0 contas do tipo "retorno".`);
  } else {
    addAward('🙅', 'Retorno? Hoje não', lockHint('não faça nenhum retorno'), `Como desbloquear:\n- Ter 0 contas do tipo "retorno".\n\nHoje: ${returnCount} retorno(s) em ${tx.length} conta(s).`, true);
  }

  if (tx.length >= 10 && returnPct >= 70) {
    addAward('🔄', 'Retorno? Hoje sim', `${returnPct}% das contas foram retorno.`, `Condição:\n- 10+ contas\n- E 70%+ do tipo "retorno".`);
  } else {
    addAward('🔄', 'Retorno? Hoje sim', lockHint('tenha 70%+ das contas como retorno (com 10+)'), `Como desbloquear:\n- Fazer 10+ contas\n- E 70%+ do tipo "retorno".`, true);
  }

  if (tx.length >= 20) {
    addAward('⛏️', 'Maratona', `${tx.length} contas registradas.`, `Condição: 20+ contas no dia.\n\nIsso mede volume, não qualidade.`);
  } else {
    addAward('⛏️', 'Maratona', lockHint('registre 20+ contas no dia'), `Como desbloquear:\n- Registre 20+ contas no dia.`, true);
  }

  if (absSaldo <= 60) {
    addAward('⚖️', 'Saldo zerado', `Seu saldo ficou bem perto de 00:00:00 (${formatSignedCompact(saldo)}).`, `Condição: saldo do dia com |saldo| ≤ 1 min.\n\nInterpretação:\n- Você terminou o dia bem equilibrado.`);
  } else if (absSaldo <= 5 * 60) {
    addAward('⚖️', 'Saldo controlado', `Seu saldo ficou perto de 00:00:00 (${formatSignedCompact(saldo)}).`, `Condição: saldo do dia com |saldo| ≤ 5 min.\n\nDica:\n- Para zerar, foque em reduzir a oscilação do (Gasto - TMA).`);
  } else {
    addAward('⚖️', 'Saldo controlado', lockHint('deixe o saldo perto de 00:00:00 (≤ 5 min)'), `Como desbloquear:\n- Termine o dia com |saldo| ≤ 5 min.\n\nSaldo atual: ${formatSignedCompact(saldo)}.`, true);
  }

  if (diffsList.length >= 10 && pctNear60s >= 60) {
    addAward('🧊', 'Perto do TMA', `${pctNear60s}% das contas ficaram a até 1 min do TMA.`, `Condição: 10+ contas e 60%+ com |Gasto - TMA| ≤ 1 min.\n\nIsso indica consistência (saldo tende a ficar perto de 00).`);
  } else {
    addAward('🧊', 'Perto do TMA', lockHint('60%+ das contas a até 1 min do TMA (com 10+ contas)'), `Como desbloquear:\n- Faça 10+ contas\n- E deixe 60%+ delas com |Gasto - TMA| ≤ 1 min.`, true);
  }

  if (diffsList.length >= 10 && pctNear20s >= 40) {
    addAward('🎯', 'Precisão', `${pctNear20s}% das contas ficaram a até 20s do TMA.`, `Condição: 10+ contas e 40%+ com |Gasto - TMA| ≤ 20s.\n\nÉ um desafio de precisão (sem correr).`);
  } else {
    addAward('🎯', 'Precisão', lockHint('40%+ das contas a até 20s do TMA (com 10+ contas)'), `Como desbloquear:\n- Faça 10+ contas\n- E deixe 40%+ delas com |Gasto - TMA| ≤ 20s.`, true);
  }

  if (diffsList.length >= 10 && maxAbsDiff <= 5 * 60) {
    addAward('🛡️', 'Sem sustos', 'Nenhuma conta saiu muito do TMA (≤ 5 min).', `Condição: 10+ contas e máximo |Gasto - TMA| ≤ 5 min.\n\nIsso ajuda o saldo a ficar perto de 00.`);
  } else {
    addAward('🛡️', 'Sem sustos', lockHint('máximo |Gasto - TMA| ≤ 5 min (com 10+ contas)'), `Como desbloquear:\n- Faça 10+ contas\n- E não deixe nenhuma passar de 5 min de diferença (pra mais ou pra menos).`, true);
  }

  if (diffsList.length >= 10 && p90Abs <= 2 * 60) {
    addAward('🧱', 'Dia estável', 'Quase tudo ficou perto do TMA (p90 ≤ 2 min).', `Condição: 10+ contas e p90 de |Gasto - TMA| ≤ 2 min.\n\nInterpretação:\n- 90% das contas não fogem muito do padrão.`);
  } else {
    addAward('🧱', 'Dia estável', lockHint('p90 de |Gasto - TMA| ≤ 2 min (com 10+ contas)'), `Como desbloquear:\n- Faça 10+ contas\n- E deixe 90% delas com |Gasto - TMA| ≤ 2 min.`, true);
  }

  if (nearStreak >= 5) {
    addAward('🔥', 'Sequência no trilho', `Sequência atual: ${nearStreak} contas bem perto do TMA.`, `Condição: 5+ contas seguidas (as mais recentes) com |Gasto - TMA| ≤ 1 min.`);
  } else {
    addAward('🔥', 'Sequência no trilho', lockHint('faça 5 contas seguidas a até 1 min do TMA'), `Como desbloquear:\n- Faça 5 contas seguidas com |Gasto - TMA| ≤ 1 min.`, true);
  }

  if (first10.length >= 5 && last10.length >= 5 && comebackAbsGain >= 30) {
    addAward('📉', 'Virada', `Você ficou mais preciso no final do dia (~${secondsToShort(comebackAbsGain)} melhor).`, `Como eu calculo:\n- Comparo a média de |Gasto - TMA| das primeiras contas vs das últimas\n\nSe melhora, o final do dia está mais “no trilho”.`);
  } else {
    addAward('📉', 'Virada', lockHint('melhore a precisão do começo para o fim'), `Como desbloquear:\n- Faça o final do dia ficar mais perto do TMA do que o começo.\n\nDica:\n- Um ajuste de processo no meio do dia já muda isso.`, true);
  }

  if (closestTx) {
    const d = Number((closestTx as any)?.difference) || 0;
    const label = `${escapeHtml(String((closestTx as any)?.item || '—'))} • ${escapeHtml(String((closestTx as any)?.type || '—'))}`;
    if (Math.abs(d) <= 20) {
      addAward('🧠', 'Conta no ponto', `Você fez uma conta quase perfeita (${formatSignedCompact(d)}).`, `O que é:\n- A conta com menor |Gasto - TMA| do dia\n\nConta:\n- ${label}`);
    } else {
      addAward('🧠', 'Conta no ponto', lockHint('faça 1 conta a até 20s do TMA'), `Como desbloquear:\n- Tenha pelo menos 1 conta com |Gasto - TMA| ≤ 20s.`, true);
    }
  }

  const OUT_MARGIN = 10 * 60;
  const FIX_MARGIN = 2 * 60;
  let bigOutlierAt = -1;
  for (let i = 0; i < txOldestFirst.length; i++) {
    const d = Number((txOldestFirst[i] as any)?.difference);
    if (!Number.isFinite(d)) continue;
    if (Math.abs(d) >= OUT_MARGIN) {
      bigOutlierAt = i;
      break;
    }
  }

  let fixedAfter = false;
  let fixStreak = 0;
  if (bigOutlierAt >= 0) {
    for (let j = bigOutlierAt + 1; j < txOldestFirst.length; j++) {
      const d = Number((txOldestFirst[j] as any)?.difference);
      if (!Number.isFinite(d)) continue;
      if (Math.abs(d) <= FIX_MARGIN) {
        fixStreak += 1;
        if (fixStreak >= 3) {
          fixedAfter = true;
          break;
        }
      } else {
        fixStreak = 0;
      }
    }
  }

  if (bigOutlierAt >= 0 && fixedAfter) {
    addAward('🧯', 'Apagou incêndio', 'O dia saiu da margem de 10 min e você trouxe de volta pro trilho.', `Condição:\n- Em algum momento, |Gasto - TMA| ≥ 10 min\n- Depois, 3 contas seguidas ficaram "perto do TMA" (|Gasto - TMA| ≤ 2 min)\n\nIsso é recuperação: o importante é voltar ao padrão.`);
  } else {
    addAward('🧯', 'Apagou incêndio', lockHint('saia da margem de 10 min e depois conserte'), `Como desbloquear:\n- Ter pelo menos 1 conta com |Gasto - TMA| ≥ 10 min\n- E depois fazer 3 contas seguidas com |Gasto - TMA| ≤ 2 min\n\nDica:\n- Use uma micro-pausa e volta com o setup padronizado.`, true);
  }

  const earliestMinutes = earliest ? earliest.getHours() * 60 + earliest.getMinutes() : null;
  const isEarlyBird = earliestMinutes !== null && earliestMinutes < 8 * 60 + 10;
  if (isEarlyBird && earliest) {
    const hh = String(earliest.getHours()).padStart(2, '0');
    const mm = String(earliest.getMinutes()).padStart(2, '0');
    addAward('🌅', 'Early bird', `Primeira conta registrada cedo (${hh}:${mm}).`, `Condição: ter uma conta registrada antes de 08:10.`);
  } else {
    addAward('🌅', 'Early bird', lockHint('registre uma conta antes de 08:10'), `Como desbloquear:\n- Registre ao menos 1 conta antes de 08:10.`, true);
  }

  if (!hasLunchWindow) {
    addAward('🥪', 'Dedicação total', lockHint('configure seu horário de almoço'), `Como desbloquear:\n- Configure o intervalo de almoço no app\n- E registre pelo menos 1 conta dentro desse intervalo.`, true);
  } else if (anyTxDuringLunch) {
    addAward('🥪', 'Dedicação total', 'Você registrou uma conta durante o almoço.', `Condição:\n- Ter um intervalo de almoço configurado\n- E registrar pelo menos 1 conta dentro do intervalo.`);
  } else {
    addAward('🥪', 'Dedicação total', lockHint('registre 1 conta durante o almoço'), `Como desbloquear:\n- Registre pelo menos 1 conta dentro do seu intervalo de almoço configurado.`, true);
  }

  if (latestHour !== null && latestHour >= 20) {
    addAward('🌙', 'Night owl', `Conta registrada tarde (≈ ${String(latestHour).padStart(2, '0')}:xx).`, `Condição: ter uma conta registrada às 20:xx ou depois.`);
  } else {
    addAward('🌙', 'Night owl', lockHint('registre uma conta às 20:xx ou depois'), `Como desbloquear:\n- Registre ao menos 1 conta a partir de 20:00.`, true);
  }

  const unlocked = awards.filter(a => !a.locked);
  const locked = awards.filter(a => a.locked);
  const unlockedCount = unlocked.length;
  const totalCount = awards.length;

  const topAwards = unlocked.slice(0, 18);
  const lockedToShow = input.showLocked ? locked.slice(0, 18) : [];

  let awardsHtml = '';
  if (!topAwards.length && !locked.length) {
    awardsHtml = `<div class="report-muted">Ainda sem achievements (por enquanto). Faça mais algumas contas e eles aparecem.</div>`;
  } else {
    const toggleLabel = input.showLocked ? 'Ocultar bloqueados' : 'Mostrar bloqueados';
    const toggleSub = input.showLocked ? 'Bloqueados visíveis.' : 'Bloqueados escondidos.';
    awardsHtml = `
      <div class="report-awards-head">
        <div>
          <div class="report-k">Achievements</div>
          <div class="report-h">${unlockedCount} desbloqueados de ${totalCount}. ${escapeHtml(toggleSub)}</div>
        </div>
        ${locked.length ? `<button type="button" class="sidebar-action" data-awards-toggle="1" style="width:auto; padding:10px 12px;">${escapeHtml(toggleLabel)}</button>` : ''}
      </div>

      <div class="report-awards">
        ${topAwards
          .map(
            a => `
          <div class="award-card is-clickable" role="button" tabindex="0" ${dataAttr(a.title, a.details || a.desc)}>
            <div class="award-icon">${escapeHtml(a.icon)}</div>
            <div>
              <div class="award-title">${escapeHtml(a.title)}</div>
              <div class="award-desc">${escapeHtml(a.desc)}</div>
            </div>
          </div>
        `,
          )
          .join('')}

        ${lockedToShow
          .map(
            a => `
          <div class="award-card is-locked">
            <div class="award-icon">🔒</div>
            <div>
              <div class="award-title">${escapeHtml(a.title)}</div>
            </div>
          </div>
        `,
          )
          .join('')}
      </div>
    `;
  }

  return { awardsHtml, daypartsHtml };
}

export function buildAdviceHtml(transactions: any[], balanceSeconds: number) {
  const tx = Array.isArray(transactions) ? transactions : [];
  if (!tx.length) {
    return {
      suggestionsHtml: `<div class="report-muted">Sem sugestões (ainda). Faça algumas transações para gerar insights.</div>`,
      funHtml: `<div class="report-muted">Sem estatísticas ainda — faz uma conta e volta aqui.</div>`,
      diffsNewestFirst: [] as number[],
      diffsOldestFirst: [] as number[],
    };
  }

  const diffsNewestFirst = tx.map(t => Number((t as any)?.difference) || 0);
  const diffsOldestFirst = diffsNewestFirst.slice().reverse();
  const total = diffsNewestFirst.length;

  const sumDiff = diffsNewestFirst.reduce((a, b) => a + b, 0);
  const saldo = Number.isFinite(Number(balanceSeconds)) ? Number(balanceSeconds) : sumDiff;
  const absSaldo = Math.abs(saldo);
  const BALANCE_MARGIN_SECONDS = 10 * 60;
  const withinMargin = absSaldo <= BALANCE_MARGIN_SECONDS;

  const absDiffs = diffsNewestFirst.map(d => Math.abs(d));
  const near60 = absDiffs.filter(s => s <= 60).length;
  const pctNear60 = Math.round((near60 / Math.max(1, total)) * 100);

  const last10 = diffsNewestFirst.slice(0, 10);
  const avgLast10 = last10.reduce((a, b) => a + b, 0) / Math.max(1, last10.length);
  const avgAll = diffsNewestFirst.reduce((a, b) => a + b, 0) / Math.max(1, total);
  const avgAbsAll = absDiffs.reduce((a, b) => a + b, 0) / Math.max(1, total);

  let nearStreak = 0;
  for (const d of diffsNewestFirst) {
    if (Math.abs(d) <= 60) nearStreak += 1;
    else break;
  }

  let closest: any = null;
  let farthest: any = null;
  for (const t of tx) {
    const d = Number((t as any)?.difference) || 0;
    const ad = Math.abs(d);
    if (!closest || ad < Math.abs(Number((closest as any)?.difference) || 0)) closest = t;
    if (!farthest || ad > Math.abs(Number((farthest as any)?.difference) || 0)) farthest = t;
  }

  const suggestionItems: string[] = [];
  const push = (tone: 'good' | 'warn' | 'bad', pill: string, text: string, details: string) => {
    suggestionItems.push(`
      <div class="report-item is-clickable" role="button" tabindex="0" ${dataAttr(String(pill), details)}>
        <div class="report-pill ${tone}">${escapeHtml(pill)}</div>
        <p>${escapeHtml(text)}</p>
      </div>
    `);
  };

  const absAvgLast10 = Math.abs(avgLast10);
  if (absAvgLast10 <= 15) {
    push(
      'good',
      'No alvo',
      `Últimas ${last10.length}: média ${formatSignedCompact(avgLast10)} (bem perto do TMA).`,
      `Como eu leio isso:\n- Eu pego as últimas ${last10.length} contas e faço a média de (Gasto - TMA)\n\nInterpretação:\n- O sinal (+/-) mostra a direção\n- "Bem" aqui é ficar perto de 0 e manter o saldo do dia dentro de ±10 min (positivo ou negativo)\n\nDica:\n- Mantém o padrão e evita outliers.`,
    );
  } else if (absAvgLast10 <= 60) {
    push(
      'warn',
      'Ajuste fino',
      `Últimas ${last10.length}: média ${formatSignedCompact(avgLast10)} (oscilando).`,
      `Você está oscilando um pouco.\n\nO que ajuda:\n- Padronizar o começo (abrir telas, conferir campos antes)\n- Buscar consistência: reduzir |Gasto - TMA|\n\nMeta real do dia:\n- Estar dentro da margem de ±10 min no saldo.`,
    );
  } else {
    push(
      'bad',
      'Atenção',
      `Últimas ${last10.length}: média ${formatSignedCompact(avgLast10)} (longe do TMA).`,
      `Aqui o foco não é ficar negativo, é reduzir o desvio.\n\nSugestões rápidas:\n- Tenta derrubar o |Gasto - TMA| nas próximas contas\n- Se o saldo do dia estiver fora da margem, um ajuste constante de 20–40s por conta já muda o final\n- Use o histograma para ver se é “padrão do processo” ou “1 conta muito fora”.`,
    );
  }

  if (withinMargin) {
    push(
      'good',
      'Margem',
      `Saldo do dia: ${formatSignedCompact(saldo)} (dentro de ±10 min).`,
      `Regra do “bem”:\n- Fechar / manter o dia dentro de ±10 min (positivo ou negativo)\n\nLeitura rápida:\n- Se o saldo está dentro da margem, você está bem mesmo que esteja positivo.`,
    );
  } else {
    push(
      'bad',
      'Margem',
      `Saldo do dia: ${formatSignedCompact(saldo)} (fora de ±10 min).`,
      `Regra do “bem”:\n- Dentro de ±10 min (positivo ou negativo)\n\nComo voltar:\n- Reduzir |Gasto - TMA| nas próximas contas\n- Evitar outliers (1 conta grande pesa muito no saldo).`,
    );
  }

  if (nearStreak >= 5) {
    push(
      'good',
      'Sequência',
      `Sequência atual: ${nearStreak} contas perto do TMA (±1 min).`,
      `Regra:\n- Conta “perto do TMA” = |Gasto - TMA| ≤ 1 min\n\nEssa sequência é só das contas mais recentes.\n\nDica:\n- Quando a sequência está boa, protege ela: mesmo ritual, menos variação.`,
    );
  } else if (nearStreak === 0) {
    push(
      'warn',
      'Quebra',
      'A última conta saiu do “perto do TMA” (±1 min). Micro-pausa ajuda.',
      `Às vezes 1 conta fora do padrão “contamina” o ritmo.\n\nDica de recuperação (30s):\n- Respira, organiza a próxima conta\n- Abre o que você vai precisar antes de começar\n\nObjetivo: reduzir |Gasto - TMA| e voltar pra margem.`,
    );
  }

  const microGoalAbs = Math.round(Math.abs(avgAll));
  if (microGoalAbs > 20) {
    const goal = clamp(microGoalAbs, 0, 600);
    push(
      'warn',
      'Meta',
      `Meta simples: reduzir ~${secondsToShort(goal)} de |diferença| por conta.`,
      `Por que isso funciona:\n- ${secondsToShort(goal)} por conta parece pouco\n- Em 20 contas vira ~${secondsToShort(goal * 20)} no saldo\n\nSugestão prática:\n- O objetivo é reduzir |Gasto - TMA| (não “ficar negativo”)\n- E manter o saldo dentro de ±10 min.`,
    );
  } else {
    push(
      'good',
      'Meta',
      'Você está com desvio pequeno em média. Mantém o ritmo.',
      `Média do dia (referência):\n- média (Gasto - TMA): ${formatSignedCompact(avgAll)}\n- média |Gasto - TMA|: ${secondsToShort(avgAbsAll)}\n\nLeitura:\n- Desvio pequeno + consistência ajuda a ficar dentro da margem.`,
    );
  }

  if (closest && farthest) {
    push(
      'warn',
      'Olho vivo',
      `Mais perto do TMA: ${formatSignedCompact(Number((closest as any).difference) || 0)}. Mais longe: ${formatSignedCompact(Number((farthest as any).difference) || 0)}.`,
      `Isso olha para |Gasto - TMA| (distância do alvo).\n\nComo usar:\n- Se a “mais longe” foi por motivo recorrente, achou um vazamento\n- Se foi algo raro, segue o jogo e foca em consistência.`,
    );
  }

  const suggestionsHtml = `<div class="report-list">${suggestionItems.join('')}</div>`;

  const returnCount = tx.filter(t => String((t as any)?.type || '').toLowerCase() === 'retorno').length;
  const complexCount = tx.filter(t => String((t as any)?.item || '') === 'Complexa').length;

  const absSaldoSeconds = Math.abs(saldo);
  const clandestineBreaks = Math.floor(absSaldoSeconds / (15 * 60));
  const songs = Math.floor(absSaldoSeconds / 210);
  const miojos = Math.floor(absSaldoSeconds / 180);
  const episodes12 = Math.floor(absSaldoSeconds / (12 * 60));

  const maxAbsDiff = absDiffs.length ? Math.max(...absDiffs) : 0;
  const near20 = absDiffs.filter(s => s <= 20).length;

  const funItems: string[] = [];
  const funPush = (pill: string, textHtml: string, tone: 'good' | 'warn' | 'bad' = 'warn') => {
    funItems.push(`
      <div class="report-item">
        <div class="report-pill ${tone}">${escapeHtml(pill)}</div>
        <p>${textHtml}</p>
      </div>
    `);
  };

  funPush('Maratona', `Hoje você registrou <b>${total}</b> contas.`);
  if (returnCount > 0) funPush('Déjà vu', `Teve <b>${returnCount}</b> retorno(s) hoje.`);
  if (complexCount > 0) funPush('Tijolinhos', `Você encarou <b>${complexCount}</b> conta(s) Complexa(s).`);
  if (near20 > 0) funPush('Sniper', `Você acertou <b>${near20}</b> conta(s) a até <b>20s</b> do TMA.`);
  if (clandestineBreaks > 0) funPush('Pausas clandestinas', `Sua distância do zero dá ~<b>${clandestineBreaks}</b> pausas clandestinas de 15 minutos.`);
  if (miojos > 0) funPush('Miojo', `Seu |saldo| dá pra cozinhar <b>${miojos}</b> miojo(s) de 3 minutos.`);
  if (episodes12 > 0) funPush('Série', `Seu |saldo| equivale a <b>${episodes12}</b> episódio(s) de 12 minutos.`);
  if (songs > 0) funPush('Playlist', `Ou <b>${songs}</b> músicas de ~3:30 (sem pular o refrão).`);
  if (maxAbsDiff > 0) funPush('Chefão do dia', `Maior desvio do TMA: <b>${escapeHtml(secondsToShort(maxAbsDiff))}</b>.`);

  const funHtml = `<div class="report-list">${funItems.join('')}</div>`;

  return { suggestionsHtml, funHtml, diffsNewestFirst, diffsOldestFirst };
}

export function buildRecentTxHtml(transactionsNewestFirst: any[]): string {
  const recent = (transactionsNewestFirst || []).slice(0, 12);
  if (!recent.length) return `<div class="report-muted">Sem histórico ainda.</div>`;

  const rows = recent
    .map(tx => {
      const item = escapeHtml(String((tx as any)?.item || '—'));
      const type = escapeHtml(String((tx as any)?.type || '—'));
      const tma = secondsToTime(Number((tx as any)?.tma) || 0);
      const spent = secondsToTime(Number((tx as any)?.timeSpent) || 0);
      const diff = formatSigned(Number((tx as any)?.difference) || 0);
      const when = escapeHtml(String((tx as any)?.timestamp || ''));
      const d = Number((tx as any)?.difference) || 0;
      const diffClass = d > 0 ? 'pos' : d < 0 ? 'neg' : 'neu';
      return `
        <tr>
          <td>${item}</td>
          <td>${type}</td>
          <td>${tma}</td>
          <td>${spent}</td>
          <td class="diff ${diffClass}">${diff}</td>
          <td class="when">${when}</td>
        </tr>
      `;
    })
    .join('');

  return `
    <div class="report-table-wrap">
      <table class="report-table">
        <thead>
          <tr>
            <th>Item</th>
            <th>Tipo</th>
            <th>TMA</th>
            <th>Gasto</th>
            <th>Dif.</th>
            <th>Quando</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

export function buildPausedListHtml(pausedWork: any): string {
  const pausedNormalized = normalizePausedWorkStore(pausedWork || {});
  const pausedEntries = Object.values(pausedNormalized).flat();
  const pausedSorted = pausedEntries.slice().sort((a: any, b: any) => String(b.updatedAtIso).localeCompare(String(a.updatedAtIso)));
  if (!pausedSorted.length) return `<div class="report-muted">Sem contas pausadas.</div>`;

  return pausedSorted
    .slice(0, 10)
    .map((p: any) => {
      const label = `${escapeHtml(p.item)} • ${escapeHtml(p.type)}`;
      const secs = secondsToTime(p.accumulatedSeconds);
      const updated = p.updatedAtIso ? new Date(p.updatedAtIso).toLocaleString() : '';
      return `
        <div class="report-row">
          <div class="report-row-main">
            <div class="report-row-title">${label}</div>
            <div class="report-row-sub">${escapeHtml(updated)}</div>
          </div>
          <div class="report-row-right">${secs}</div>
        </div>
      `;
    })
    .join('');
}

export function getThemeColorsFromCss() {
  const cs = getComputedStyle(document.body);
  const pick = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  return {
    text: pick('--text', '#eaeaea'),
    muted: pick('--muted', 'rgba(255,255,255,.7)'),
    border: pick('--border', 'rgba(255,255,255,.12)'),
    panel: pick('--panel', 'rgba(255,255,255,.04)'),
    good: pick('--good', '#3ddc97'),
    bad: pick('--bad', '#ff4d4d'),
    warn: pick('--warn', '#f7b731'),
    accent: pick('--accent', pick('--good', '#3ddc97')),
  };
}

export function setCanvasSizeToCss(canvas: HTMLCanvasElement) {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.floor(rect.width * dpr));
  const h = Math.max(1, Math.floor(rect.height * dpr));
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
}

export function drawAxes(ctx: CanvasRenderingContext2D, plot: { x: number; y: number; w: number; h: number }, colors: any) {
  ctx.save();
  ctx.strokeStyle = colors.border;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(plot.x, plot.y);
  ctx.lineTo(plot.x, plot.y + plot.h);
  ctx.lineTo(plot.x + plot.w, plot.y + plot.h);
  ctx.stroke();
  ctx.restore();
}

export function drawWorkHoursByHourStacked(
  canvas: HTMLCanvasElement,
  hours: Array<{ workMinutes: number; idleMinutes: number }>,
  opts?: { xLabelEvery?: number; title?: string },
) {
  setCanvasSizeToCss(canvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const colors = getThemeColorsFromCss();
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const dpr = window.devicePixelRatio || 1;
  const pad = 18 * dpr;
  const leftPad = pad + 34 * dpr;
  const bottomPad = pad + 26 * dpr;
  const plot = { x: leftPad, y: pad, w: w - leftPad - pad, h: h - pad - bottomPad };

  const normalized = new Array(24).fill(0).map((_, i) => {
    const v = hours?.[i] || ({} as any);
    return {
      workMinutes: Math.max(0, Number(v.workMinutes) || 0),
      idleMinutes: Math.max(0, Number(v.idleMinutes) || 0),
    };
  });

  const totals = normalized.map(v => v.workMinutes + v.idleMinutes);
  const maxTotal = Math.max(1, ...totals);

  const maxRounded = (() => {
    // Keep the axis stable and readable: 30-min steps for small values, then 60-min.
    if (maxTotal <= 60) return Math.max(30, Math.ceil(maxTotal / 30) * 30);
    return Math.ceil(maxTotal / 60) * 60;
  })();

  // light horizontal grid
  ctx.save();
  ctx.strokeStyle = colors.border;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 1;
  const lines = 4;
  for (let i = 0; i <= lines; i++) {
    const y = plot.y + (plot.h * i) / lines;
    ctx.beginPath();
    ctx.moveTo(plot.x, y);
    ctx.lineTo(plot.x + plot.w, y);
    ctx.stroke();
  }
  ctx.restore();

  drawAxes(ctx, plot, colors);

  const gap = 5 * dpr;
  const bars = 24;
  const barW = (plot.w - gap * (bars + 1)) / bars;
  const usableH = plot.h - 8 * dpr;

  for (let i = 0; i < bars; i++) {
    const v = normalized[i];
    const total = v.workMinutes + v.idleMinutes;
    if (total <= 0) continue;

    const x = plot.x + gap + i * (barW + gap);
    const workH = (v.workMinutes / maxRounded) * usableH;
    const idleH = (v.idleMinutes / maxRounded) * usableH;
    const yBase = plot.y + plot.h;

    // Work segment (bottom)
    if (workH > 0.5) {
      ctx.save();
      ctx.fillStyle = colors.accent;
      ctx.globalAlpha = 0.85;
      ctx.fillRect(x, yBase - workH, barW, workH);
      ctx.restore();
    }

    // Idle segment (top)
    if (idleH > 0.5) {
      ctx.save();
      ctx.fillStyle = colors.warn;
      ctx.globalAlpha = 0.85;
      ctx.fillRect(x, yBase - workH - idleH, barW, idleH);
      ctx.restore();
    }
  }

  const every = Math.max(1, Math.floor(Number(opts?.xLabelEvery) || 3));
  ctx.save();
  ctx.fillStyle = colors.muted;
  ctx.font = `${10.5 * dpr}px system-ui`;
  for (let i = 0; i < bars; i += every) {
    const x = plot.x + gap + i * (barW + gap);
    const y = plot.y + plot.h + 18 * dpr;
    ctx.fillText(`${i}`, x + 1 * dpr, y);
  }
  ctx.restore();

  // Y labels
  ctx.save();
  ctx.fillStyle = colors.muted;
  ctx.font = `${11 * dpr}px system-ui`;
  const topLabel = `${Math.round(maxRounded)} min`;
  const midLabel = `${Math.round(maxRounded / 2)} min`;
  ctx.fillText(topLabel, 6 * dpr, plot.y + 10 * dpr);
  ctx.fillText(midLabel, 6 * dpr, plot.y + plot.h * 0.5);
  ctx.fillText('0', 6 * dpr, plot.y + plot.h);
  ctx.restore();

  // In-chart legend
  ctx.save();
  const legendX = plot.x + plot.w - 160 * dpr;
  const legendY = plot.y + 8 * dpr;
  ctx.globalAlpha = 0.95;
  ctx.fillStyle = colors.panel;
  ctx.strokeStyle = colors.border;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(legendX, legendY, 152 * dpr, 42 * dpr, 10 * dpr);
  ctx.fill();
  ctx.stroke();

  ctx.globalAlpha = 0.85;
  ctx.fillStyle = colors.accent;
  ctx.fillRect(legendX + 10 * dpr, legendY + 12 * dpr, 10 * dpr, 10 * dpr);
  ctx.fillStyle = colors.warn;
  ctx.fillRect(legendX + 10 * dpr, legendY + 26 * dpr, 10 * dpr, 10 * dpr);

  ctx.globalAlpha = 0.9;
  ctx.fillStyle = colors.text;
  ctx.font = `${10.5 * dpr}px system-ui`;
  ctx.fillText('Trabalho', legendX + 28 * dpr, legendY + 21 * dpr);
  ctx.fillText('Idle', legendX + 28 * dpr, legendY + 35 * dpr);
  ctx.restore();

  if (opts?.title) {
    ctx.save();
    ctx.fillStyle = colors.text;
    ctx.font = `${12 * dpr}px system-ui`;
    ctx.fillText(String(opts.title), plot.x, pad - 4 * dpr);
    ctx.restore();
  }
}

export function drawBalanceLineChart(canvas: HTMLCanvasElement, transactionsOldestFirst: any[]) {
  setCanvasSizeToCss(canvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const colors = getThemeColorsFromCss();
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const dpr = window.devicePixelRatio || 1;
  const pad = 18 * dpr;
  const plot = { x: pad + 42 * dpr, y: pad, w: w - (pad * 2 + 42 * dpr), h: h - pad * 2 - 18 * dpr };

  const tx = Array.isArray(transactionsOldestFirst) ? transactionsOldestFirst : [];
  const diffs = tx.map(t => Number((t as any)?.difference) || 0);
  if (!tx.length) {
    ctx.fillStyle = colors.muted;
    ctx.font = `${12 * dpr}px system-ui`;
    ctx.fillText('Sem transações para desenhar.', plot.x, plot.y + 18 * dpr);
    return;
  }

  const cumulative: number[] = [];
  let sum = 0;
  for (const d of diffs) {
    sum += d;
    cumulative.push(sum);
  }

  const minV = Math.min(0, ...cumulative);
  const maxV = Math.max(0, ...cumulative);
  const span = Math.max(1, maxV - minV);

  const points = tx.map((t, idx) => {
    const dt = parseTxDate((t as any)?.timestamp);
    return { idx, dt, t: dt ? dt.getTime() : null };
  });

  const ts = points.map(p => p.t).filter(v => Number.isFinite(v as any)) as number[];
  const hasTime = ts.length >= Math.max(2, Math.floor(tx.length * 0.5));
  const tMin = hasTime ? Math.min(...ts) : 0;
  const tMax = hasTime ? Math.max(...ts) : 1;
  const tSpan = Math.max(1, tMax - tMin);

  const xForIndex = (i: number) => {
    const t = tx.length === 1 ? 1 : i / (tx.length - 1);
    return plot.x + t * plot.w;
  };

  const xForPoint = (p: any) => {
    if (!hasTime || !Number.isFinite(p.t)) return xForIndex(p.idx);
    const t = (p.t - tMin) / tSpan;
    return plot.x + t * plot.w;
  };

  // grid Y
  ctx.save();
  ctx.strokeStyle = colors.border;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 1;
  const lines = 4;
  for (let i = 0; i <= lines; i++) {
    const y = plot.y + (plot.h * i) / lines;
    ctx.beginPath();
    ctx.moveTo(plot.x, y);
    ctx.lineTo(plot.x + plot.w, y);
    ctx.stroke();
  }
  ctx.restore();

  // grid X + hour labels
  if (hasTime) {
    const spanHours = tSpan / 36e5;
    const stepHours = spanHours <= 6 ? 1 : spanHours <= 12 ? 2 : 3;

    const start = new Date(tMin);
    start.setMinutes(0, 0, 0);
    if (start.getTime() < tMin) start.setHours(start.getHours() + 1);

    ctx.save();
    ctx.strokeStyle = colors.border;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 1;
    ctx.fillStyle = colors.muted;
    ctx.globalAlpha = 0.85;
    ctx.font = `${10.5 * dpr}px system-ui`;

    for (let d = new Date(start); d.getTime() <= tMax; d.setHours(d.getHours() + stepHours)) {
      const x = plot.x + ((d.getTime() - tMin) / tSpan) * plot.w;
      ctx.save();
      ctx.globalAlpha = 0.25;
      ctx.beginPath();
      ctx.moveTo(x, plot.y);
      ctx.lineTo(x, plot.y + plot.h);
      ctx.stroke();
      ctx.restore();

      const hh = String(d.getHours()).padStart(2, '0');
      ctx.fillText(`${hh}:00`, x - 12 * dpr, plot.y + plot.h + 14 * dpr);
    }
    ctx.restore();
  } else {
    ctx.save();
    ctx.fillStyle = colors.muted;
    ctx.font = `${10.5 * dpr}px system-ui`;
    ctx.fillText('X = ordem (sem horário válido)', plot.x, plot.y + plot.h + 14 * dpr);
    ctx.restore();
  }

  drawAxes(ctx, plot, colors);

  const zeroY = plot.y + plot.h - ((0 - minV) / span) * plot.h;
  ctx.save();
  ctx.strokeStyle = colors.muted;
  ctx.globalAlpha = 0.8;
  ctx.setLineDash([6 * dpr, 6 * dpr]);
  ctx.beginPath();
  ctx.moveTo(plot.x, zeroY);
  ctx.lineTo(plot.x + plot.w, zeroY);
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.lineWidth = 2.2 * dpr;
  ctx.strokeStyle = colors.accent;
  ctx.beginPath();
  for (let i = 0; i < cumulative.length; i++) {
    const x = xForPoint(points[i]);
    const y = plot.y + plot.h - ((cumulative[i] - minV) / span) * plot.h;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.restore();

  const end = cumulative[cumulative.length - 1];
  const endX = xForPoint(points[points.length - 1]);
  const endY = plot.y + plot.h - ((end - minV) / span) * plot.h;
  ctx.save();
  ctx.fillStyle = end <= 0 ? colors.good : colors.bad;
  ctx.beginPath();
  ctx.arc(endX, endY, 3.5 * dpr, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.fillStyle = colors.muted;
  ctx.font = `${11 * dpr}px system-ui`;
  ctx.fillText(formatSignedCompact(maxV), 6 * dpr, plot.y + 10 * dpr);
  ctx.fillText(formatSignedCompact(minV), 6 * dpr, plot.y + plot.h);
  ctx.restore();
}

export function drawDiffHistogram(canvas: HTMLCanvasElement, diffsSecondsNewestFirst: number[]) {
  setCanvasSizeToCss(canvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const colors = getThemeColorsFromCss();
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const dpr = window.devicePixelRatio || 1;
  const pad = 18 * dpr;
  const plot = { x: pad, y: pad, w: w - pad * 2, h: h - pad * 2 - 22 * dpr };

  const diffs = Array.isArray(diffsSecondsNewestFirst) ? diffsSecondsNewestFirst.map(n => Number(n) || 0) : [];
  if (!diffs.length) {
    ctx.fillStyle = colors.muted;
    ctx.font = `${12 * dpr}px system-ui`;
    ctx.fillText('Sem transações para desenhar.', plot.x, plot.y + 18 * dpr);
    return;
  }

  const bins = [
    { label: '≤ -5 min', min: -Infinity, max: -300 },
    { label: '-5..-2 min', min: -300, max: -120 },
    { label: '-2 min..-30s', min: -120, max: -30 },
    { label: '-30..+30s', min: -30, max: 30 },
    { label: '+30s..+2 min', min: 30, max: 120 },
    { label: '+2..+5 min', min: 120, max: 300 },
    { label: '≥ +5 min', min: 300, max: Infinity },
  ];

  const counts = new Array(bins.length).fill(0);
  for (const d of diffs) {
    const idx = bins.findIndex(b => d > b.min && d <= b.max);
    if (idx >= 0) counts[idx] += 1;
  }
  const maxCount = Math.max(1, ...counts);

  drawAxes(ctx, plot, colors);

  const gap = 8 * dpr;
  const barW = (plot.w - gap * (bins.length + 1)) / bins.length;

  for (let i = 0; i < bins.length; i++) {
    const c = counts[i];
    const barH = (c / maxCount) * (plot.h - 8 * dpr);
    const x = plot.x + gap + i * (barW + gap);
    const y = plot.y + plot.h - barH;

    const isGood = bins[i].max <= 0;
    const isBad = bins[i].min >= 0;
    let fill = colors.warn;
    if (isGood) fill = colors.good;
    if (isBad) fill = colors.bad;

    ctx.save();
    ctx.fillStyle = fill;
    ctx.globalAlpha = 0.85;
    const r = 10 * dpr;
    const rr = Math.min(r, barW / 2, barH / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + barW, y, x + barW, y + barH, rr);
    ctx.arcTo(x + barW, y + barH, x, y + barH, rr);
    ctx.arcTo(x, y + barH, x, y, rr);
    ctx.arcTo(x, y, x + barW, y, rr);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  ctx.save();
  ctx.fillStyle = colors.muted;
  ctx.font = `${10 * dpr}px system-ui`;
  for (let i = 0; i < bins.length; i++) {
    const x = plot.x + gap + i * (barW + gap);
    const y = plot.y + plot.h + 26 * dpr;
    ctx.save();
    ctx.translate(x + 2 * dpr, y);
    ctx.rotate(-0.38);
    ctx.fillText(bins[i].label, 0, 0);
    ctx.restore();
  }
  ctx.restore();
}

export function modalBodyToHtml(bodyText: string): string {
  const raw = String(bodyText || '').trim();
  if (!raw) return '<p>Sem detalhes.</p>';
  const parts = raw.split('\n\n');
  const html = parts
    .map(block => {
      const lines = block
        .split('\n')
        .map(l => l.trim())
        .filter(Boolean);
      const bullets = lines.filter(l => l.startsWith('- ')).map(l => escapeHtml(l.slice(2)));
      const normals = lines.filter(l => !l.startsWith('- ')).map(l => escapeHtml(l));
      const p = normals.length ? `<p>${normals.join('<br>')}</p>` : '';
      const ul = bullets.length ? `<ul>${bullets.map(b => `<li>${b}</li>`).join('')}</ul>` : '';
      return p + ul;
    })
    .join('');
  return html || '<p>Sem detalhes.</p>';
}
