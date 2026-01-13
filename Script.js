let timeBalance = 0; // Segundo
let transactions = [];

// Keys de Storage
const STORAGE_BAL = 'tma_comp_balance_v1';
const STORAGE_TX = 'tma_comp_transactions_v1';
const STORAGE_LUNCH = 'tma_comp_lunch_v1';
const STORAGE_COMPLEXA = 'tma_comp_show_complexa_v1';
const STORAGE_ANALYTICS = 'tma_comp_analytics_v1';

const ANALYTICS_SCHEMA_VERSION = 1;
const MAX_ANALYTICS_EVENTS = 2000;

let analytics = null;

// Elementos
const balanceDisplay = document.getElementById('balance');
const currentTimeDisplay = document.getElementById('currentTime');
const turnoNow = document.getElementById('turnoNow');
const turnoEnd = document.getElementById('turnoEnd');
const turnoWorkLeft = document.getElementById('turnoWorkLeft');
const turnoStatus = document.getElementById('turnoStatus');
const timeToggle = document.getElementById('timeToggle');
const modal = document.getElementById('timeModal');
const timeInput = document.getElementById('timeInput');
const infoText = document.getElementById('infoText');
const modalTitle = document.getElementById('modalTitle');
const closeModalBtn = document.querySelector('.close-modal');
const cancelBtn = document.querySelector('.btn-cancel');
const confirmBtn = document.querySelector('.btn-confirm');
const actionBtns = document.querySelectorAll('.btn-action');
const historyContainer = document.getElementById('history');
const resetBtn = document.getElementById('resetBtn');
const endDayBtn = document.getElementById('endDayBtn');
const lunchModal = document.getElementById('lunchModal');
const lunchInput = document.getElementById('lunchInput');
const closeLunchModalBtn = document.querySelector('.close-lunch-modal');
const lunchConfirmBtn = document.querySelector('.btn-lunch-confirm');
const debugPanel = document.getElementById('debugPanel');
const debugTimeInput = document.getElementById('debugTimeInput');
const setDebugTimeBtn = document.getElementById('setDebugTimeBtn');
const resetDebugTimeBtn = document.getElementById('resetDebugTimeBtn');
const realTimeDisplay = document.getElementById('realTimeDisplay');
const debugTimeDisplay = document.getElementById('debugTimeDisplay');
const lunchDisplay = document.getElementById('lunchDisplay');
const debugBalanceDisplay = document.getElementById('debugBalanceDisplay');
const lunchModeDisplay = document.getElementById('lunchModeDisplay');
const toggleLunchStyle = document.getElementById('toggleLunchStyle');
const complexaToggle = document.getElementById('complexaToggle');
const complexaToggleDebug = document.getElementById('complexaToggleDebug');
const debugOpenLunchPromptBtn = document.getElementById('debugOpenLunchPromptBtn');
const debugResetPromptsBtn = document.getElementById('debugResetPromptsBtn');
const accountsCount = document.getElementById('accountsCount');
const assistantBody = document.getElementById('assistantBody');

// Debug shift simulator
const simSpeed = document.getElementById('simSpeed');
const simStartBtn = document.getElementById('simStartBtn');
const simPauseBtn = document.getElementById('simPauseBtn');
const simResetBtn = document.getElementById('simResetBtn');
const simStatus = document.getElementById('simStatus');

const DAILY_QUOTA = 17;
const BALANCE_MARGIN_SECONDS = 10 * 60;

const SHIFT_START_SECONDS = 8 * 3600; // 08:00
const SHIFT_END_SECONDS = 17 * 3600 + 48 * 60; // 17:48

let simTimerId = null;
let simRunning = false;

let assistantDetailsOpen = false;

let flowMode = false;
let activeTimers = {}; // to track timers per button

function getActiveTimerKey() {
    const keys = Object.keys(activeTimers || {});
    return keys.length ? keys[0] : null;
}

let currentTMA = 0;
let currentType = '';
let currentItem = '';

let lunchStart = null;
let lunchEnd = null;

let showComplexa = false;

let debugTime = null; // for testing, seconds since midnight
let lunchStyleEnabled = true;

let cachedActionCatalog = null;

if (toggleLunchStyle) {
    // Ensure switch is checked by default
    toggleLunchStyle.checked = true;
    toggleLunchStyle.addEventListener('change', function() {
        lunchStyleEnabled = this.checked;
        ensureAnalytics();
        logEvent('lunch_style_enabled_set', { enabled: lunchStyleEnabled });
        if (!lunchStyleEnabled) {
            document.body.classList.remove('lunch-mode');
        }
        updateCurrentTime();
    });
}

// Traduz tempo em segundos
// Aceita HH:MM:SS, MM:SS, MM, or H:MM:SS
function timeToSeconds(timeString) {
    if (!timeString) return null;
    const parts = timeString.trim().split(':').map(s => s.replace(/[^0-9]/g, ''));
    if (parts.length === 1) {
        const minutes = parseInt(parts[0], 10);
        if (isNaN(minutes)) return null;
        return minutes * 60;
    }
    if (parts.length === 2) {
        const minutes = parseInt(parts[0], 10) || 0;
        const seconds = parseInt(parts[1], 10) || 0;
        return minutes * 60 + seconds;
    }
    // 3 ou mais -> recebe os ultimos 3 como hh:mm:ss
    const last = parts.slice(-3);
    const hours = parseInt(last[0], 10) || 0;
    const minutes = parseInt(last[1], 10) || 0;
    const seconds = parseInt(last[2], 10) || 0;
    if ([hours, minutes, seconds].some(n => isNaN(n))) return null;
    return hours * 3600 + minutes * 60 + seconds;
}

function secondsToTime(seconds) {
    // Verifica se o valor é negativo e armazena o sinal
    const sign = seconds < 0 ? '-' : '';
    
    // Pega o valor absoluto e arredonda para um número inteiro
    const absSeconds = Math.abs(Math.round(seconds));
    
    // Calcula as horas (divide por 3600 segundos)
    const hours = Math.floor(absSeconds / 3600);
    
    // Calcula os minutos (pega o resto de horas e divide por 60)
    const minutes = Math.floor((absSeconds % 3600) / 60);
    
    // Calcula os segundos restantes (resto da divisão por 60)
    const secs = absSeconds % 60;
    
    // Retorna a string formatada HH:MM:SS com o sinal à frente se for negativo
    return sign + String(hours).padStart(2, '0') + ':' + String(minutes).padStart(2, '0') + ':' + String(secs).padStart(2, '0');
}

function formatSignedTime(seconds) {
    const s = Math.round(Number(seconds) || 0);
    const sign = s > 0 ? '+' : (s < 0 ? '-' : '');
    return sign + secondsToTime(Math.abs(s));
}

function secondsToHuman(seconds) {
    const abs = Math.max(0, Math.floor(Number(seconds) || 0));
    const h = Math.floor(abs / 3600);
    const m = Math.floor((abs % 3600) / 60);
    if (h <= 0) return `${m}m`;
    return `${h}h ${String(m).padStart(2, '0')}m`;
}

function secondsToClockHHMM(seconds) {
    const s = Math.max(0, Math.floor(Number(seconds) || 0));
    const hh = Math.floor(s / 3600) % 24;
    const mm = Math.floor((s % 3600) / 60);
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function overlapSeconds(aStart, aEnd, bStart, bEnd) {
    const start = Math.max(aStart, bStart);
    const end = Math.min(aEnd, bEnd);
    return Math.max(0, end - start);
}

function getCurrentSeconds() {
    const now = new Date();
    const realSeconds = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
    const currentSeconds = (debugTime !== null) ? debugTime : realSeconds;
    return { realSeconds, currentSeconds };
}

function createAnalytics() {
    const nowIso = new Date().toISOString();
    const rand = Math.random().toString(36).slice(2, 10);
    return {
        schemaVersion: ANALYTICS_SCHEMA_VERSION,
        sessionId: `sess_${nowIso.replace(/[:.]/g, '-')}_${rand}`,
        createdAtIso: nowIso,
        lastUpdatedAtIso: nowIso,
        settings: {
            dailyQuota: DAILY_QUOTA,
            balanceMarginSeconds: BALANCE_MARGIN_SECONDS,
            shiftStartSeconds: SHIFT_START_SECONDS,
            shiftEndSeconds: SHIFT_END_SECONDS,
        },
        counters: {
            txAdded: 0,
            txDeleted: 0,
            resetAll: 0,
            endDayExport: 0,
        },
        assistant: {
            detailsOpens: 0,
            detailsCloses: 0,
            recommendationsShown: 0,
            recommendationsFollowed: 0,
            perType: {},
            lastRecoSig: null,
            lastReco: null,
        },
        flow: {
            modeEnabledCount: 0,
            modeDisabledCount: 0,
            timerStarts: 0,
            timerStops: 0,
            blockedStartOther: 0,
            blockedLeaveWithRunning: 0,
        },
        lunch: {
            configuredCount: 0,
        },
        debug: {
            setDebugTimeCount: 0,
            resetDebugTimeCount: 0,
            simStartCount: 0,
            simPauseCount: 0,
            simResetCount: 0,
        },
        ui: {
            assistantSimplified: true,
        },
        eventLog: [],
    };
}

function ensureAnalytics() {
    if (!analytics) analytics = createAnalytics();
}

function saveAnalytics() {
    try {
        ensureAnalytics();
        analytics.lastUpdatedAtIso = new Date().toISOString();
        localStorage.setItem(STORAGE_ANALYTICS, JSON.stringify(analytics));
    } catch {
        // ignore storage failures
    }
}

function loadAnalytics() {
    try {
        const raw = localStorage.getItem(STORAGE_ANALYTICS);
        if (!raw) {
            analytics = createAnalytics();
            saveAnalytics();
            return;
        }
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') throw new Error('Invalid analytics');

        // Minimal schema guard
        if (parsed.schemaVersion !== ANALYTICS_SCHEMA_VERSION) {
            analytics = createAnalytics();
            saveAnalytics();
            return;
        }

        analytics = parsed;
    } catch {
        analytics = createAnalytics();
        saveAnalytics();
    }
}

function resetAnalytics() {
    analytics = createAnalytics();
    saveAnalytics();
}

function getAnalyticsTimeContext() {
    const { realSeconds, currentSeconds } = getCurrentSeconds();
    return {
        tsIso: new Date().toISOString(),
        currentSeconds,
        realSeconds,
        debugTimeSeconds: (debugTime !== null) ? debugTime : null,
        flowMode: Boolean(flowMode),
        isLunch: Boolean(lunchStart && lunchEnd && currentSeconds >= lunchStart && currentSeconds < lunchEnd),
    };
}

function logEvent(type, data = {}) {
    ensureAnalytics();
    const ctx = getAnalyticsTimeContext();
    analytics.eventLog.push({ type, ...ctx, data });
    if (analytics.eventLog.length > MAX_ANALYTICS_EVENTS) {
        analytics.eventLog.splice(0, analytics.eventLog.length - MAX_ANALYTICS_EVENTS);
    }
    saveAnalytics();
}

function bumpPerType(key, field) {
    ensureAnalytics();
    if (!analytics.assistant.perType[key]) {
        analytics.assistant.perType[key] = { shown: 0, followed: 0 };
    }
    analytics.assistant.perType[key][field] = (analytics.assistant.perType[key][field] || 0) + 1;
}

function trackAssistantRecommendation(reco, avgDiffTarget, remainingAccounts) {
    if (!reco || !reco.best || !reco.best.key) return;
    ensureAnalytics();

    // Avoid logging every second: only when the "best" or the rounded target changes
    const roundedTarget = Math.round((Number(avgDiffTarget) || 0) / 30) * 30; // 30s steps
    const sig = `${reco.best.key}|${roundedTarget}`;
    if (analytics.assistant.lastRecoSig === sig) return;

    analytics.assistant.lastRecoSig = sig;
    analytics.assistant.recommendationsShown += 1;
    bumpPerType(reco.best.key, 'shown');

    const { currentSeconds } = getCurrentSeconds();
    analytics.assistant.lastReco = {
        key: reco.best.key,
        item: reco.best.item,
        type: reco.best.type,
        label: reco.best.label,
        shownAtIso: new Date().toISOString(),
        shownAtSeconds: currentSeconds,
        avgDiffTargetSeconds: roundedTarget,
        timeBalanceSeconds: Number(timeBalance) || 0,
        remainingAccounts: Number(remainingAccounts) || 0,
        followed: false,
    };

    logEvent('assistant_reco_shown', {
        key: reco.best.key,
        item: reco.best.item,
        type: reco.best.type,
        avgDiffTargetSeconds: roundedTarget,
        remainingAccounts,
    });
}

function markRecommendationFollowedIfMatch(tx, source) {
    ensureAnalytics();
    const last = analytics.assistant.lastReco;
    if (!last || last.followed) return;

    const key = `${String(tx?.item || '')}__${String(tx?.type || '')}`;
    if (!key || key !== last.key) return;

    // Consider it "followed" if it's the next matching transaction within 30 minutes of the recommendation
    const { currentSeconds } = getCurrentSeconds();
    if (Number.isFinite(last.shownAtSeconds) && (currentSeconds - last.shownAtSeconds) > 30 * 60) return;

    last.followed = true;
    last.followedAtIso = new Date().toISOString();
    analytics.assistant.recommendationsFollowed += 1;
    bumpPerType(last.key, 'followed');
    logEvent('assistant_reco_followed', {
        key: last.key,
        item: tx?.item,
        type: tx?.type,
        source,
        difference: tx?.difference,
    });
    saveAnalytics();
}

function getShiftInfo(currentSeconds) {
    const shiftStart = SHIFT_START_SECONDS;
    const shiftEnd = SHIFT_END_SECONDS;
    const totalShiftSeconds = 9 * 3600 + 48 * 60; // 09:48

    let remainingShiftSeconds;
    if (currentSeconds < shiftStart) remainingShiftSeconds = totalShiftSeconds;
    else if (currentSeconds > shiftEnd) remainingShiftSeconds = 0;
    else remainingShiftSeconds = shiftEnd - currentSeconds;

    return { shiftStart, shiftEnd, totalShiftSeconds, remainingShiftSeconds };
}

function getElapsedWorkSeconds(currentSeconds) {
    const { shiftStart, shiftEnd } = getShiftInfo(currentSeconds);
    if (currentSeconds <= shiftStart) return 0;
    const end = Math.min(currentSeconds, shiftEnd);
    let elapsed = Math.max(0, end - shiftStart);
    if (lunchStart && lunchEnd) {
        elapsed -= overlapSeconds(shiftStart, end, lunchStart, lunchEnd);
    }
    return Math.max(0, elapsed);
}

function getTotalWorkSeconds() {
    const shiftStart = SHIFT_START_SECONDS;
    const shiftEnd = SHIFT_END_SECONDS;
    let total = Math.max(0, shiftEnd - shiftStart);
    if (lunchStart && lunchEnd) {
        total -= overlapSeconds(shiftStart, shiftEnd, lunchStart, lunchEnd);
    }
    return Math.max(0, total);
}

function setSimStatus(text) {
    if (simStatus) simStatus.textContent = text;
}

function setSimRunning(nextRunning) {
    simRunning = Boolean(nextRunning);
    if (simTimerId) {
        clearInterval(simTimerId);
        simTimerId = null;
    }

    if (!simRunning) {
        setSimStatus('Paused');
        return;
    }

    const tickMs = 250;
    setSimStatus('Running');
    simTimerId = setInterval(() => {
        const speed = parseFloat(simSpeed?.value || '60');
        if (debugTime === null) {
            debugTime = SHIFT_START_SECONDS;
        }
        debugTime += speed * (tickMs / 1000);
        if (debugTime >= SHIFT_END_SECONDS) {
            debugTime = SHIFT_END_SECONDS;
            setSimRunning(false);
            setSimStatus('Finished');
        }
        updateCurrentTime();
    }, tickMs);
}

function getRemainingWorkSeconds(currentSeconds) {
    const { shiftEnd, remainingShiftSeconds } = getShiftInfo(currentSeconds);
    if (remainingShiftSeconds <= 0) return 0;

    if (lunchStart && lunchEnd) {
        const lunchOverlap = overlapSeconds(currentSeconds, shiftEnd, lunchStart, lunchEnd);
        return Math.max(0, remainingShiftSeconds - lunchOverlap);
    }

    return remainingShiftSeconds;
}

function getActionCatalog() {
    if (Array.isArray(cachedActionCatalog) && cachedActionCatalog.length) return cachedActionCatalog;
    const btns = Array.from(document.querySelectorAll('.btn-action'));
    cachedActionCatalog = btns.map(btn => {
        const item = String(btn.dataset.item || '');
        const type = String(btn.dataset.type || '');
        const tma = parseInt(btn.dataset.tma, 10) || 0;
        const label = (type === 'conferencia' ? '📋 Conferencia' : '🔄 Retorno');
        return {
            key: `${item}__${type}`,
            item,
            type,
            tma,
            label,
        };
    }).filter(a => a.item && a.type);

    if (!showComplexa) {
        cachedActionCatalog = cachedActionCatalog.filter(a => a.item !== 'Complexa');
    }
    return cachedActionCatalog;
}

function applyComplexaVisibility() {
    const complexCards = document.querySelectorAll('.control-box[data-account="Complexa"]');
    complexCards.forEach(el => {
        el.classList.toggle('is-hidden', !showComplexa);
    });

    // If hiding while a complex timer is running, block by reverting state
    const activeKey = getActiveTimerKey();
    if (!showComplexa && activeKey && activeKey.startsWith('Complexa-')) {
        showComplexa = true;
        localStorage.setItem(STORAGE_COMPLEXA, '1');
        complexCards.forEach(el => el.classList.remove('is-hidden'));
        if (complexaToggle) complexaToggle.checked = true;
        if (complexaToggleDebug) complexaToggleDebug.checked = true;
        alert('Pare o timer da Complexa antes de esconder essa opção.');
        return;
    }

    // Reset cached catalog so assistant recommendations update
    cachedActionCatalog = null;
    updateAssistant();
    updateFlowUI();
}

function openLunchPrompt({ prefill = true } = {}) {
    if (!lunchModal) return;

    if (prefill) {
        if (lunchInput) {
            lunchInput.value = (lunchStart !== null && lunchStart !== undefined) ? secondsToClockHHMM(lunchStart) : '';
        }
        if (complexaToggle) {
            complexaToggle.checked = Boolean(showComplexa);
        }
    }

    lunchModal.style.display = 'flex';
    try {
        if (lunchInput) lunchInput.focus();
    } catch {
        // ignore
    }
}

function computePerTypeStats() {
    // Group by item+type (TMA comes from the button, but tx also stores it)
    const stats = new Map();
    for (const tx of (transactions || [])) {
        const item = String(tx?.item || '');
        const type = String(tx?.type || '');
        if (!item || !type) continue;
        const key = `${item}__${type}`;

        const diff = Number(tx?.difference);
        if (!Number.isFinite(diff)) continue;

        const prev = stats.get(key) || { count: 0, sumDiff: 0, sumAbsDiff: 0 };
        prev.count += 1;
        prev.sumDiff += diff;
        prev.sumAbsDiff += Math.abs(diff);
        stats.set(key, prev);
    }

    // Convert sums to means
    for (const [key, s] of stats.entries()) {
        stats.set(key, {
            ...s,
            avgDiff: s.count ? (s.sumDiff / s.count) : 0,
            avgAbsDiff: s.count ? (s.sumAbsDiff / s.count) : 0,
        });
    }
    return stats;
}

function getAssistantRecommendation({ remainingAccounts, avgDiffTarget }) {
    const actions = getActionCatalog();
    const stats = computePerTypeStats();

    if (!actions.length) return null;

    // Score actions by closeness to target, with a small preference for more-sampled types.
    const scored = actions.map(a => {
        const s = stats.get(a.key);
        const hasHistory = Boolean(s && s.count);
        const expectedDiff = hasHistory ? s.avgDiff : 0; // neutral fallback if no history
        const distance = Math.abs(expectedDiff - avgDiffTarget);
        const confidence = hasHistory ? Math.min(1, Math.log10(1 + s.count) / 1.0) : 0; // 0..1
        const score = distance - (confidence * 90); // bonus up to ~90s for high-sample actions

        return {
            ...a,
            hasHistory,
            sampleCount: s?.count || 0,
            expectedDiff,
            distance,
            score,
        };
    });

    scored.sort((x, y) => x.score - y.score);

    const best = scored[0];
    const alternatives = scored.slice(1, 4);
    const targetLabel = avgDiffTarget < 0 ? 'mais rápido' : 'mais devagar';

    return {
        best,
        alternatives,
        targetLabel,
        avgDiffTarget,
        remainingAccounts,
    };
}

function updateAssistant() {
    if (!assistantBody) return;

    // Preserve details open state across re-renders (assistant updates frequently)
    const existingDetails = assistantBody.querySelector('details');
    if (existingDetails) {
        assistantDetailsOpen = existingDetails.open;
    }

    const done = Array.isArray(transactions) ? transactions.length : 0;
    const remainingAccounts = Math.max(DAILY_QUOTA - done, 0);

    const { currentSeconds } = getCurrentSeconds();
    const { shiftStart, shiftEnd, remainingShiftSeconds } = getShiftInfo(currentSeconds);
    const remainingWorkSeconds = getRemainingWorkSeconds(currentSeconds);
    const elapsedWorkSeconds = getElapsedWorkSeconds(currentSeconds);
    const totalWorkSeconds = getTotalWorkSeconds();

    const withinMarginNow = Math.abs(timeBalance) <= BALANCE_MARGIN_SECONDS;

    const expectedDoneNow = totalWorkSeconds > 0
        ? Math.min(DAILY_QUOTA, Math.floor((elapsedWorkSeconds / totalWorkSeconds) * DAILY_QUOTA))
        : 0;
    const quotaDelta = done - expectedDoneNow;

    const currentPacePerHour = elapsedWorkSeconds > 0 ? (done / (elapsedWorkSeconds / 3600)) : 0;
    const projectedEndCount = elapsedWorkSeconds > 0 && totalWorkSeconds > 0
        ? Math.round((done / elapsedWorkSeconds) * totalWorkSeconds)
        : done;

    if (currentSeconds > shiftEnd) {
        assistantBody.innerHTML = `
            <div class="kpi"><span>Contas</span><span class="value">${done}/${DAILY_QUOTA}</span></div>
            <div class="kpi"><span>Saldo</span><span class="value ${withinMarginNow ? 'ok' : 'warn'}">${formatSignedTime(timeBalance)}</span></div>
            <div class="muted">Turno encerrado.</div>
        `;
        return;
    }

    if (currentSeconds < shiftStart) {
        assistantBody.innerHTML = `
            <div class="kpi"><span>Contas</span><span class="value">${done}/${DAILY_QUOTA}</span></div>
            <div class="kpi"><span>Saldo</span><span class="value ${withinMarginNow ? 'ok' : 'warn'}">${formatSignedTime(timeBalance)}</span></div>
            <div class="muted">Antes do turno. Objetivo: manter o saldo perto de 00:00:00.</div>
        `;
        return;
    }

    if (remainingAccounts === 0) {
        assistantBody.innerHTML = `
            <div class="kpi"><span>Contas</span><span class="value">${done}/${DAILY_QUOTA}</span></div>
            <div class="kpi"><span>Saldo</span><span class="value ${withinMarginNow ? 'ok' : 'warn'}">${formatSignedTime(timeBalance)}</span></div>
            <div class="muted">Quota feita. Agora é só cuidar do saldo.</div>
        `;
        return;
    }

    const hoursLeft = remainingWorkSeconds / 3600;
    const pacePerHour = hoursLeft > 0 ? (remainingAccounts / hoursLeft) : Infinity;
    const budgetPerAccountSeconds = remainingWorkSeconds > 0 ? (remainingWorkSeconds / remainingAccounts) : 0;

    // Per-account difference needed to end within ±10m
    const avgDiffMin = (-BALANCE_MARGIN_SECONDS - timeBalance) / remainingAccounts;
    const avgDiffMax = (BALANCE_MARGIN_SECONDS - timeBalance) / remainingAccounts;
    const avgDiffTarget = (-timeBalance) / remainingAccounts;

    // Predict end balance if user keeps current average performance
    const diffs = (transactions || []).map(t => Number(t?.difference)).filter(n => Number.isFinite(n));
    const avgDiffSoFar = diffs.length ? (diffs.reduce((a, b) => a + b, 0) / diffs.length) : 0;
    const predictedEnd = timeBalance + avgDiffSoFar * remainingAccounts;
    const predictedOk = Math.abs(predictedEnd) <= BALANCE_MARGIN_SECONDS;

    const targetLabel = avgDiffTarget < 0 ? 'mais rápido' : 'mais devagar';

    const reco = getAssistantRecommendation({ remainingAccounts, avgDiffTarget });
    trackAssistantRecommendation(reco, avgDiffTarget, remainingAccounts);
    const recoHtml = reco ? `
        <div class="assistant-reco">
            <div class="assistant-reco__title">Sugestão agora</div>
            <div class="assistant-reco__row">
                <div class="assistant-reco__main">
                    <div class="assistant-reco__name"><strong>${reco.best.item}</strong> • ${reco.best.label}</div>
                    <div class="assistant-reco__meta muted">
                        Pra zerar o saldo: tente ficar em média <strong>${formatSignedTime(avgDiffTarget)}</strong> por conta.
                        ${reco.best.hasHistory
                            ? ` Nesse tipo, sua média é <span class="${Math.abs(reco.best.expectedDiff - avgDiffTarget) <= 120 ? 'ok' : 'warn'}">${formatSignedTime(reco.best.expectedDiff)}</span> (${reco.best.sampleCount}x).`
                            : ` Ainda não tem histórico desse tipo.`}
                    </div>
                </div>
            </div>
            ${reco.alternatives.length ? `
                <div class="assistant-reco__alts muted">Alternativas: ${reco.alternatives.map(a => `${a.item} • ${a.label}`).join(' | ')}</div>
            ` : ''}
        </div>
    ` : '';

    assistantBody.innerHTML = `
        <div class="kpi"><span>Contas</span><span class="value">${done}/${DAILY_QUOTA}</span></div>
        <div class="kpi"><span>Faltam</span><span class="value">${remainingAccounts}</span></div>
        <div class="kpi"><span>Tempo restante</span><span class="value">${secondsToHuman(remainingWorkSeconds)}</span></div>
        <div class="kpi"><span>Precisa fazer</span><span class="value">${Number.isFinite(pacePerHour) ? pacePerHour.toFixed(1) : '∞'} contas/h</span></div>
        <div class="kpi"><span>Saldo</span><span class="value ${withinMarginNow ? 'ok' : 'warn'}">${formatSignedTime(timeBalance)}</span></div>

        ${recoHtml}

        <details>
            <summary>Detalhes</summary>
            <div class="details-grid">
                <div class="kpi"><span>Meta até agora</span><span class="value">${expectedDoneNow}/${DAILY_QUOTA}</span></div>
                <div class="kpi"><span>Você está</span><span class="value ${quotaDelta >= 0 ? 'ok' : 'warn'}">${quotaDelta >= 0 ? 'adiantado' : 'atrasado'} (${quotaDelta >= 0 ? '+' : ''}${quotaDelta})</span></div>
                <div class="kpi"><span>Seu ritmo</span><span class="value">${currentPacePerHour ? currentPacePerHour.toFixed(1) : '0.0'} contas/h</span></div>
                <div class="kpi"><span>Tempo por conta</span><span class="value">${secondsToTime(budgetPerAccountSeconds)}</span></div>
                <div class="muted">Saldo ideal por conta: ${formatSignedTime(avgDiffTarget)} (${targetLabel}).</div>
                <div class="muted">Faixa ok (±10m no fim): ${formatSignedTime(avgDiffMin)} a ${formatSignedTime(avgDiffMax)}.</div>
                <div class="muted">Se continuar na mesma média (${formatSignedTime(avgDiffSoFar)}), termina em <span class="${predictedOk ? 'ok' : 'warn'}">${formatSignedTime(predictedEnd)}</span>.</div>
                <div class="muted">Projeção de contas: ~<strong>${Math.min(projectedEndCount, DAILY_QUOTA)}/${DAILY_QUOTA}</strong>.</div>
            </div>
        </details>
    `;

    const newDetails = assistantBody.querySelector('details');
    if (newDetails) {
        newDetails.open = assistantDetailsOpen;
    }
}

// Make the "Detalhes" expander behave like a stable toggle
if (assistantBody) {
    assistantBody.addEventListener('click', (e) => {
        const summary = e.target.closest('summary');
        if (!summary) return;
        const details = summary.closest('details');
        if (!details) return;

        // Prevent native toggle; we manage it to persist across re-renders
        e.preventDefault();
        details.open = !details.open;
        assistantDetailsOpen = details.open;

        ensureAnalytics();
        if (details.open) analytics.assistant.detailsOpens += 1;
        else analytics.assistant.detailsCloses += 1;
        logEvent('assistant_details_toggle', { open: details.open });
    });
}

    // Salva estado no localStorage
function saveState() {
    localStorage.setItem(STORAGE_BAL, String(timeBalance));
    localStorage.setItem(STORAGE_TX, JSON.stringify(transactions));
}

    // Carrega estado do localStorage
function loadState() {
    const b = localStorage.getItem(STORAGE_BAL);
    const tx = localStorage.getItem(STORAGE_TX);
    const l = localStorage.getItem(STORAGE_LUNCH);
    const cplx = localStorage.getItem(STORAGE_COMPLEXA);
    timeBalance = b ? parseInt(b, 10) : 0;
    transactions = tx ? JSON.parse(tx) : [];

    // Complexa preference (default: hidden unless user opts in)
    showComplexa = cplx === '1';
    if (complexaToggle) complexaToggle.checked = showComplexa;
    if (complexaToggleDebug) complexaToggleDebug.checked = showComplexa;

    if (l) {
        const lunch = JSON.parse(l);
        lunchStart = lunch.start;
        lunchEnd = lunch.end;
    } else {
        // First time, show lunch modal
        lunchModal.style.display = 'flex';
    }

    // Apply after DOM is ready
    applyComplexaVisibility();
}


    // Atualiza display do saldo
function updateBalanceDisplay() {

    timeBalance = Number(timeBalance) || 0;
    balanceDisplay.textContent = (timeBalance > 0 ? '+' : '') + secondsToTime(timeBalance);
    
    balanceDisplay.className = 'balance-value';
    // UX: if within ±10 minutes, it's OK (green); otherwise attention (red)
    if (Math.abs(timeBalance) <= BALANCE_MARGIN_SECONDS) {
        balanceDisplay.classList.add('positive');
    } else {
        balanceDisplay.classList.add('negative');
    }

    updateAssistant();
}
    // Atualiza UI para flow mode
function updateFlowUI() {
    const btns = document.querySelectorAll('.btn-action');
    const activeKey = getActiveTimerKey();
    btns.forEach(btn => {
        const key = `${btn.dataset.item}-${btn.dataset.type}`;
        const type = btn.dataset.type;
        const originalText = type === 'conferencia' ? '📋 Conferencia' : '🔄 Retorno';
        
        // Se tiver timer ativo, mostra "Stop"
        if (activeTimers[key]) {
            btn.textContent = 'Stop';
            btn.classList.add('start-btn');
        } else {
            btn.textContent = originalText;
            btn.classList.remove('start-btn');
        }

        // While a timer is running, lock out all other actions
        if (flowMode && activeKey && key !== activeKey) {
            btn.disabled = true;
        } else {
            btn.disabled = false;
        }
    });
}
    // Handle timer in flow mode
function handleFlowTimer(btn, item, type, tma) {
    const key = `${item}-${type}`;
    const timerDisplay = btn.closest('.control-box').querySelector('.timer-display');

    const activeKey = getActiveTimerKey();
    if (activeKey && activeKey !== key) {
        ensureAnalytics();
        analytics.flow.blockedStartOther += 1;
        logEvent('flow_timer_blocked_start_other', { activeKey, attemptedKey: key, item, type });
        alert('Finalize o timer atual antes de iniciar outro.');
        return;
    }
    
    if (activeTimers[key]) {
        // Stop timer - save transaction
        clearInterval(activeTimers[key].interval);
        const elapsed = Math.floor((Date.now() - activeTimers[key].start) / 1000);
        delete activeTimers[key];

        ensureAnalytics();
        analytics.flow.timerStops += 1;
        logEvent('flow_timer_stop', { key, item, type, tma, elapsedSeconds: elapsed });
        
        // Reset display
        timerDisplay.textContent = '00:00:00';
        
        // Add transaction
        addFlowTransaction(item, type, tma, elapsed);
        
        // Update button appearance
        updateFlowUI();
    } else {
        // Start timer
        const startTime = Date.now();
        activeTimers[key] = { start: startTime, interval: null };
        btn.textContent = 'Stop';
        btn.classList.add('start-btn');

        ensureAnalytics();
        analytics.flow.timerStarts += 1;
        logEvent('flow_timer_start', { key, item, type, tma });
        
        // Update timer display every 100ms for smooth updates
        activeTimers[key].interval = setInterval(() => {
            const elapsed = Math.floor((Date.now() - startTime) / 1000);
            timerDisplay.textContent = secondsToTime(elapsed);
        }, 100);

        // Lock other buttons
        updateFlowUI();
    }
}
    // Add transaction from flow mode
function addFlowTransaction(item, type, tma, timeSpent) {
    const difference = timeSpent - tma;
    timeBalance += difference;
    const creditedMinutes = Math.round(Math.abs(difference) / 60);
    ensureAnalytics();
    const lastReco = analytics.assistant?.lastReco || null;
    const tx = {
        item: item,
        type: type,
        tma: tma,
        timeSpent: timeSpent,
        difference: difference,
        creditedMinutes: creditedMinutes,
        timestamp: new Date().toLocaleString(),
        source: 'flow',
        assistant: lastReco ? {
            lastRecoKey: lastReco.key,
            lastRecoShownAtIso: lastReco.shownAtIso,
            lastRecoAvgDiffTargetSeconds: lastReco.avgDiffTargetSeconds,
        } : null,
    };
    transactions.unshift(tx);

    analytics.counters.txAdded += 1;
    logEvent('tx_add', {
        source: 'flow',
        item,
        type,
        key: `${item}__${type}`,
        tma,
        timeSpent,
        difference,
    });
    markRecommendationFollowedIfMatch(tx, 'flow');

    saveState();
    updateBalanceDisplay();
    updateHistory();
}
    // Atualiza display da hora atual
function updateCurrentTime() {
    const realNow = new Date();
    const realSeconds = realNow.getHours() * 3600 + realNow.getMinutes() * 60 + realNow.getSeconds();
    let currentSeconds;
    if (debugTime !== null) {
        currentSeconds = debugTime;
    } else {
        currentSeconds = realSeconds;
    }
    const shiftStart = SHIFT_START_SECONDS;
    const shiftEnd = SHIFT_END_SECONDS;
    const totalShiftSeconds = 9 * 3600 + 48 * 60; // 09:48

    let remainingSeconds;
    if (currentSeconds < shiftStart) {
        remainingSeconds = totalShiftSeconds;
    } else if (currentSeconds > shiftEnd) {
        remainingSeconds = 0;
    } else {
        remainingSeconds = shiftEnd - currentSeconds;
    }

    const hours = Math.floor(remainingSeconds / 3600);
    const minutes = Math.floor((remainingSeconds % 3600) / 60);
    // UX: keep Turno Atual stable (no seconds)
    const formatted = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
    currentTimeDisplay.textContent = formatted;

    // Check lunch time
    const isLunch = lunchStart && lunchEnd && currentSeconds >= lunchStart && currentSeconds < lunchEnd;

    // Turno extra info
    if (turnoNow) turnoNow.textContent = secondsToClockHHMM(currentSeconds);
    if (turnoEnd) turnoEnd.textContent = secondsToClockHHMM(shiftEnd);
    if (turnoWorkLeft) turnoWorkLeft.textContent = secondsToHuman(getRemainingWorkSeconds(currentSeconds));

    if (turnoStatus) {
        if (currentSeconds < shiftStart) turnoStatus.textContent = 'Antes do turno';
        else if (currentSeconds >= shiftEnd) turnoStatus.textContent = 'Turno encerrado';
        else if (isLunch) turnoStatus.textContent = 'Em almoço';
        else turnoStatus.textContent = 'Trabalhando';
    }
    // Flow mode must NOT be active during lunch; lunch mode takes precedence visually
    if (lunchStyleEnabled && isLunch) {
        document.body.classList.add('lunch-mode');
        // force flow off visually
        document.body.classList.remove('flow-mode');
    } else {
        document.body.classList.remove('lunch-mode');
        document.body.classList.toggle('flow-mode', flowMode);
    }

    // Update debug displays
    updateDebugInfo(realSeconds, currentSeconds, isLunch);

    // Update assistant guidance
    updateAssistant();
}

function updateDebugInfo(realSeconds, currentSeconds, isLunch) {
    // Real time
    const rh = Math.floor(realSeconds / 3600);
    const rm = Math.floor((realSeconds % 3600) / 60);
    const rs = realSeconds % 60;
    realTimeDisplay.textContent = `${String(rh).padStart(2, '0')}:${String(rm).padStart(2, '0')}:${String(rs).padStart(2, '0')}`;

    // Debug time
    if (debugTime !== null) {
        const dh = Math.floor(debugTime / 3600);
        const dm = Math.floor((debugTime % 3600) / 60);
        const ds = debugTime % 60;
        debugTimeDisplay.textContent = `${String(dh).padStart(2, '0')}:${String(dm).padStart(2, '0')}:${String(ds).padStart(2, '0')}`;
    } else {
        debugTimeDisplay.textContent = 'Not set';
    }

    // Lunch
    if (lunchStart && lunchEnd) {
        const lh = Math.floor(lunchStart / 3600);
        const lm = Math.floor((lunchStart % 3600) / 60);
        const leh = Math.floor(lunchEnd / 3600);
        const lem = Math.floor((lunchEnd % 3600) / 60);
        lunchDisplay.textContent = `${String(lh).padStart(2, '0')}:${String(lm).padStart(2, '0')} - ${String(leh).padStart(2, '0')}:${String(lem).padStart(2, '0')}`;
    } else {
        lunchDisplay.textContent = 'Not set';
    }

    // Balance
    debugBalanceDisplay.textContent = secondsToTime(timeBalance);

    // Lunch mode
    lunchModeDisplay.textContent = isLunch ? 'Yes' : 'No';
}
    // Logica de Modal (Cringe) 
function openModal(item, type, tma) {

    currentItem = item;
    currentType = type;
    currentTMA = tma;
    modalTitle.textContent = `${item} - ${type.charAt(0).toUpperCase() + type.slice(1)}`;
    infoText.textContent = 'TMA: ' + secondsToTime(tma);

    // Preenche input com placeholder do TMA
    timeInput.value = '';
    timeInput.placeholder = secondsToTime(tma);
    timeInput.focus();
    modal.classList.add('active');
}


function closeModal() {
    modal.classList.remove('active');
    timeInput.value = '';
}

    // Adiciona transação ao histórico
function addTransaction() {
    const timeSpent = timeToSeconds(timeInput.value);
    if (timeSpent === null) {
        alert('Invalid time format. Use HH:MM or HH:MM:SS or minutes (e.g. 12)');
        return;
    }

    // Calcula diferença entre tempo gasto e TMA
    // positivo -> user foi mais lento que TMA (Saldo positivo)
    // negativo -> user foi mais rápido que TMA (Saldo negativo)
    const difference = timeSpent - currentTMA;

    // Aplica a diferença ao saldo. Positivo -> saldo aumenta, Negativo -> saldo diminui
    timeBalance += difference;

    // Calcula minutos creditados (valor absoluto arredondado)
    const creditedMinutes = Math.round(Math.abs(difference) / 60);

    ensureAnalytics();
    const lastReco = analytics.assistant?.lastReco || null;

    const tx = {
        item: currentItem,
        type: currentType,
        tma: currentTMA,
        timeSpent: timeSpent,
        difference: difference,
        creditedMinutes: creditedMinutes,
        timestamp: new Date().toLocaleString(),
        source: 'modal',
        assistant: lastReco ? {
            lastRecoKey: lastReco.key,
            lastRecoShownAtIso: lastReco.shownAtIso,
            lastRecoAvgDiffTargetSeconds: lastReco.avgDiffTargetSeconds,
        } : null,
    };

    transactions.unshift(tx);

    analytics.counters.txAdded += 1;
    logEvent('tx_add', {
        source: 'modal',
        item: currentItem,
        type: currentType,
        key: `${currentItem}__${currentType}`,
        tma: currentTMA,
        timeSpent,
        difference,
    });
    markRecommendationFollowedIfMatch(tx, 'modal');

    saveState();
    updateBalanceDisplay();
    updateHistory();
    closeModal();
}

    // Atualiza histórico de transações
function updateHistory() {
    if (!transactions || transactions.length === 0) {
        historyContainer.innerHTML = '';
        updateAccountsCounter();
        updateAssistant();
        return;
    }
    historyContainer.innerHTML = transactions.map((t, idx) => `
        <div class="history-item">
            <div class="history-info">
                <h4>${t.item} - ${t.type.charAt(0).toUpperCase() + t.type.slice(1)}</h4>
                <p>Gasto: ${secondsToTime(t.timeSpent)} • TMA: ${secondsToTime(t.tma)} • ${t.timestamp}</p>
            </div>
            <div class="history-actions">
                <div class="history-time ${Math.abs(t.difference) <= 600 ? 'neutral' : (t.difference >= 0 ? 'positive' : 'negative')}">
                    ${t.difference >= 0 ? '+' : ''}${secondsToTime(t.difference)}
                    <div style="font-size:0.8em;color:#666">(${t.difference >= 0 ? '+' : '-'}${t.creditedMinutes} min)</div>
                </div>
                <button class="history-delete" type="button" data-action="delete" data-index="${idx}" title="Excluir lançamento" aria-label="Excluir lançamento">✕</button>
            </div>
        </div>
    `).join('');

    updateAccountsCounter();
    updateAssistant();
}

// Delete a transaction (misinput safety)
if (historyContainer) {
    historyContainer.addEventListener('click', (e) => {
        const btn = e.target.closest('button.history-delete');
        if (!btn) return;
        const idx = parseInt(btn.dataset.index, 10);
        if (!Number.isFinite(idx) || idx < 0 || idx >= (transactions?.length || 0)) return;

        const tx = transactions[idx];
        const item = String(tx?.item || '');
        const type = String(tx?.type || '');
        if (!confirm(`Excluir este lançamento?\n\n${item} - ${type}`)) return;

        const diff = Number(tx?.difference) || 0;
        timeBalance = (Number(timeBalance) || 0) - diff;
        transactions.splice(idx, 1);

        ensureAnalytics();
        analytics.counters.txDeleted += 1;
        logEvent('tx_delete', {
            index: idx,
            item,
            type,
            key: `${item}__${type}`,
            tma: tx?.tma,
            timeSpent: tx?.timeSpent,
            difference: diff,
            source: tx?.source || null,
        });

        saveState();
        updateBalanceDisplay();
        updateHistory();
    });
}

// Contador de contas (transações)
function updateAccountsCounter() {
    if (accountsCount) {
        accountsCount.textContent = transactions.length;
    }
}

// updateHistory already updates the counter + assistant

// Event Listeners
actionBtns.forEach(btn => {
    btn.addEventListener('click', function () {
        const item = this.dataset.item;
        const type = this.dataset.type;
        const tma = parseInt(this.dataset.tma, 10) || 0;
        if (flowMode) {
            handleFlowTimer(this, item, type, tma);
        } else {
            openModal(item, type, tma);
        }
    });
});

closeModalBtn.addEventListener('click', closeModal);
cancelBtn.addEventListener('click', closeModal);
confirmBtn.addEventListener('click', addTransaction);

document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeModal();
});

modal.addEventListener('click', function (e) {
    if (e.target === modal) closeModal();
});

timeInput.addEventListener('keypress', function (e) {
    if (e.key === 'Enter') addTransaction();
});

timeToggle.addEventListener('change', function () {
    // Don't allow leaving flow mode with an active timer (avoids hidden running timers)
    if (!this.checked && getActiveTimerKey()) {
        ensureAnalytics();
        analytics.flow.blockedLeaveWithRunning += 1;
        logEvent('flow_mode_disable_blocked_running_timer', {});
        alert('Pare o timer atual antes de sair do Flow Mode.');
        this.checked = true;
        return;
    }
    flowMode = this.checked;

    ensureAnalytics();
    if (flowMode) analytics.flow.modeEnabledCount += 1;
    else analytics.flow.modeDisabledCount += 1;
    logEvent('flow_mode_set', { enabled: flowMode });

    updateFlowUI();
    updateCurrentTime();
});

// Shift simulator events
if (simStartBtn) simStartBtn.addEventListener('click', () => {
    // If no debug time, start at shift start
    if (debugTime === null) debugTime = SHIFT_START_SECONDS;
    ensureAnalytics();
    analytics.debug.simStartCount += 1;
    logEvent('debug_sim_start', { speed: parseFloat(simSpeed?.value || '60') });
    setSimRunning(true);
    updateCurrentTime();
});

if (simPauseBtn) simPauseBtn.addEventListener('click', () => {
    ensureAnalytics();
    analytics.debug.simPauseCount += 1;
    logEvent('debug_sim_pause', {});
    setSimRunning(false);
    updateCurrentTime();
});

if (simResetBtn) simResetBtn.addEventListener('click', () => {
    ensureAnalytics();
    analytics.debug.simResetCount += 1;
    logEvent('debug_sim_reset', {});
    setSimRunning(false);
    debugTime = null;
    setSimStatus('Stopped');
    updateCurrentTime();
});

    // Reseta saldo e histórico
function resetAll() {
    if (!confirm('Reset time balance and history? This cannot be undone.')) return;
    timeBalance = 0;
    transactions = [];
    resetAnalytics();
    ensureAnalytics();
    analytics.counters.resetAll += 1;
    logEvent('reset_all', {});
    saveState();
    updateBalanceDisplay();
    updateHistory();
}

if (resetBtn) resetBtn.addEventListener('click', resetAll);

    // Finaliza dia de trabalho e exporta dados como JSON
function endWorkDay() {
    ensureAnalytics();
    analytics.counters.endDayExport += 1;
    logEvent('end_day_export', {});

    const exportDateIso = new Date().toISOString();
    const { realSeconds, currentSeconds } = getCurrentSeconds();
    const shift = getShiftInfo(currentSeconds);
    const remainingWorkSeconds = getRemainingWorkSeconds(currentSeconds);
    const elapsedWorkSeconds = getElapsedWorkSeconds(currentSeconds);
    const totalWorkSeconds = getTotalWorkSeconds();

    const perTypeStats = computePerTypeStats();
    const perTypeStatsExport = Array.from(perTypeStats.entries()).map(([key, s]) => ({
        key,
        count: s.count,
        avgDiffSeconds: s.avgDiff,
        avgAbsDiffSeconds: s.avgAbsDiff,
    }));

    const done = Array.isArray(transactions) ? transactions.length : 0;
    const remainingAccounts = Math.max(DAILY_QUOTA - done, 0);
    const withinMargin = Math.abs(Number(timeBalance) || 0) <= BALANCE_MARGIN_SECONDS;

    const exportData = {
        exportSchemaVersion: 2,
        exportDate: exportDateIso,
        app: {
            name: 'TMA Compensator',
            userAgent: (typeof navigator !== 'undefined' ? navigator.userAgent : null),
            language: (typeof navigator !== 'undefined' ? navigator.language : null),
        },
        settings: {
            dailyQuota: DAILY_QUOTA,
            balanceMarginSeconds: BALANCE_MARGIN_SECONDS,
            shiftStartSeconds: SHIFT_START_SECONDS,
            shiftEndSeconds: SHIFT_END_SECONDS,
            lunchStartSeconds: lunchStart,
            lunchEndSeconds: lunchEnd,
            lunchStyleEnabled,
            showComplexa,
        },
        snapshot: {
            now: {
                currentSeconds,
                currentClock: secondsToClockHHMM(currentSeconds),
                realSeconds,
            },
            shift: {
                shiftStartSeconds: shift.shiftStart,
                shiftEndSeconds: shift.shiftEnd,
                remainingShiftSeconds: shift.remainingShiftSeconds,
                remainingWorkSeconds,
                elapsedWorkSeconds,
                totalWorkSeconds,
            },
            quota: {
                done,
                target: DAILY_QUOTA,
                remaining: remainingAccounts,
            },
            balance: {
                seconds: Number(timeBalance) || 0,
                formatted: secondsToTime(timeBalance),
                withinMargin,
                marginSeconds: BALANCE_MARGIN_SECONDS,
            },
            modes: {
                flowMode,
                lunchModeActive: Boolean(lunchStart && lunchEnd && currentSeconds >= lunchStart && currentSeconds < lunchEnd),
                debugTimeActive: debugTime !== null,
            },
        },
        derivedStats: {
            perType: perTypeStatsExport,
        },
        assistantAnalytics: analytics,
        transactionCount: done,
        transactions: transactions,
    };
    
    const dataStr = JSON.stringify(exportData, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;

    // Nome do arquivo com data
    const dateStr = new Date().toISOString().split('T')[0];
    link.download = `TMA_Compensator_${dateStr}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

if (endDayBtn) endDayBtn.addEventListener('click', endWorkDay);

// Lunch modal events
if (closeLunchModalBtn) closeLunchModalBtn.addEventListener('click', () => {
    lunchModal.style.display = 'none';
});
if (lunchConfirmBtn) lunchConfirmBtn.addEventListener('click', () => {
    const lunchTime = lunchInput.value.trim();
    const parts = lunchTime.split(':');
    if (parts.length === 2) {
        const hours = parseInt(parts[0], 10);
        const minutes = parseInt(parts[1], 10);
        if (!isNaN(hours) && !isNaN(minutes) && hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
            lunchStart = hours * 3600 + minutes * 60;
            lunchEnd = lunchStart + 3600; // 1 hour
            localStorage.setItem(STORAGE_LUNCH, JSON.stringify({start: lunchStart, end: lunchEnd}));

            // Save Complexa preference together with lunch setup
            if (complexaToggle) {
                showComplexa = Boolean(complexaToggle.checked);
                localStorage.setItem(STORAGE_COMPLEXA, showComplexa ? '1' : '0');
                if (complexaToggleDebug) complexaToggleDebug.checked = showComplexa;
                applyComplexaVisibility();

                ensureAnalytics();
                logEvent('complexa_enabled_set', { enabled: showComplexa, source: 'lunch_modal' });
            }

            lunchModal.style.display = 'none';

            ensureAnalytics();
            analytics.lunch.configuredCount += 1;
            logEvent('lunch_set', { lunchStart, lunchEnd });
        } else {
            alert('Formato de horário inválido. Use HH:MM');
        }
    } else {
        alert('Formato de horário inválido. Use HH:MM');
    }
});

// Debug: re-open / reset onboarding prompts
if (debugOpenLunchPromptBtn) {
    debugOpenLunchPromptBtn.addEventListener('click', () => {
        ensureAnalytics();
        logEvent('debug_open_lunch_prompt', {});
        openLunchPrompt({ prefill: true });
    });
}

if (debugResetPromptsBtn) {
    debugResetPromptsBtn.addEventListener('click', () => {
        const ok = confirm('Isso vai resetar as perguntas iniciais (almoço e Complexa) e abrir o prompt de novo. Continuar?');
        if (!ok) return;

        // Clear first-run state
        try {
            localStorage.removeItem(STORAGE_LUNCH);
            localStorage.removeItem(STORAGE_COMPLEXA);
        } catch {
            // ignore
        }

        lunchStart = null;
        lunchEnd = null;

        // Back to default (Complexa hidden) until user opts in again
        showComplexa = false;
        if (complexaToggle) complexaToggle.checked = false;
        if (complexaToggleDebug) complexaToggleDebug.checked = false;
        applyComplexaVisibility();

        ensureAnalytics();
        logEvent('debug_reset_prompts', {});

        updateCurrentTime();
        openLunchPrompt({ prefill: true });
    });
}

// Complexa preference from debug panel
if (complexaToggleDebug) {
    complexaToggleDebug.addEventListener('change', () => {
        showComplexa = Boolean(complexaToggleDebug.checked);
        localStorage.setItem(STORAGE_COMPLEXA, showComplexa ? '1' : '0');
        if (complexaToggle) complexaToggle.checked = showComplexa;
        applyComplexaVisibility();
        ensureAnalytics();
        logEvent('complexa_enabled_set', { enabled: showComplexa, source: 'debug_panel' });
    });
}

// Debug events
if (setDebugTimeBtn) setDebugTimeBtn.addEventListener('click', () => {
    const timeStr = debugTimeInput.value.trim();
    const parts = timeStr.split(':');
    if (parts.length === 3) {
        const hours = parseInt(parts[0], 10);
        const minutes = parseInt(parts[1], 10);
        const seconds = parseInt(parts[2], 10);
        if (!isNaN(hours) && !isNaN(minutes) && !isNaN(seconds) && hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59 && seconds >= 0 && seconds <= 59) {
            debugTime = hours * 3600 + minutes * 60 + seconds;
            ensureAnalytics();
            analytics.debug.setDebugTimeCount += 1;
            logEvent('debug_time_set', { debugTimeSeconds: debugTime });
            updateCurrentTime();
        } else {
            alert('Formato de horário inválido. Use HH:MM:SS');
        }
    } else {
        alert('Formato de horário inválido. Use HH:MM:SS');
    }
});
if (resetDebugTimeBtn) resetDebugTimeBtn.addEventListener('click', () => {
    debugTime = null;
    ensureAnalytics();
    analytics.debug.resetDebugTimeCount += 1;
    logEvent('debug_time_reset', {});
    if (typeof setSimRunning === 'function') {
        setSimRunning(false);
    }
    if (simStatus) simStatus.textContent = 'Stopped';
    updateCurrentTime();
});

function isTypingTarget(target) {
    const el = target;
    if (!el) return false;
    const tag = String(el.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
    if (el.isContentEditable) return true;
    return false;
}

// Toggle debug panel with a browser-safe hotkey.
// - F2: reliable across browsers (doesn't collide with common shortcuts)
// - Ctrl+Alt+D: fallback
document.addEventListener('keydown', (e) => {
    if (!debugPanel) return;
    if (isTypingTarget(e.target)) return;

    const key = String(e.key || '');
    const isF2 = key === 'F2';
    const isCtrlAltD = e.ctrlKey && e.altKey && key.toLowerCase() === 'd';

    if (isF2 || isCtrlAltD) {
        e.preventDefault();
        debugPanel.style.display = debugPanel.style.display === 'none' ? 'block' : 'none';
        ensureAnalytics();
        logEvent('debug_panel_toggle_hotkey', { hotkey: isF2 ? 'F2' : 'Ctrl+Alt+D' });
    }
});

// Inicialização
loadAnalytics();
loadState();
updateBalanceDisplay();
updateHistory();
updateCurrentTime();
setInterval(updateCurrentTime, 1000);
