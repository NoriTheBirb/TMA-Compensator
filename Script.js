
let timeBalance = 0; // Segundo
let transactions = [];

// Keys de Storage
const STORAGE_BAL = 'tma_comp_balance_v1';
const STORAGE_TX = 'tma_comp_transactions_v1';

// Elementos
const balanceDisplay = document.getElementById('balance');
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

let currentTMA = 0;
let currentType = '';
let currentItem = '';

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

    // Salva estado no localStorage
function saveState() {
    localStorage.setItem(STORAGE_BAL, String(timeBalance));
    localStorage.setItem(STORAGE_TX, JSON.stringify(transactions));
}

    // Carrega estado do localStorage
function loadState() {
    const b = localStorage.getItem(STORAGE_BAL);
    const tx = localStorage.getItem(STORAGE_TX);
    timeBalance = b ? parseInt(b, 10) : 0;
    transactions = tx ? JSON.parse(tx) : [];
}


    // Atualiza display do saldo
function updateBalanceDisplay() {

    timeBalance = Number(timeBalance) || 0;
    balanceDisplay.textContent = secondsToTime(timeBalance);
    
    balanceDisplay.className = 'balance-value';
    if (timeBalance > 0) balanceDisplay.classList.add('positive');
    else if (timeBalance < 0) balanceDisplay.classList.add('negative');
    else balanceDisplay.classList.add('zero');
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

    const tx = {
        item: currentItem,
        type: currentType,
        tma: currentTMA,
        timeSpent: timeSpent,
        difference: difference,
        creditedMinutes: creditedMinutes,
        timestamp: new Date().toLocaleString()
    };

    transactions.unshift(tx);
    saveState();
    updateBalanceDisplay();
    updateHistory();
    closeModal();
}

    // Atualiza histórico de transações
function updateHistory() {
    if (!transactions || transactions.length === 0) {
        historyContainer.innerHTML = '';
        return;
    }
    historyContainer.innerHTML = transactions.map(t => `
        <div class="history-item">
            <div class="history-info">
                <h4>${t.item} - ${t.type.charAt(0).toUpperCase() + t.type.slice(1)}</h4>
                <p>Spent: ${secondsToTime(t.timeSpent)} • TMA: ${secondsToTime(t.tma)} • ${t.timestamp}</p>
            </div>
            <div class="history-time ${t.difference >= 0 ? 'positive' : 'negative'}">
                ${t.difference >= 0 ? '+' : ''}${secondsToTime(t.difference)}
                <div style="font-size:0.8em;color:#666">(${t.difference >= 0 ? '+' : '-'}${t.creditedMinutes} min)</div>
            </div>
        </div>
    `).join('');
}

// Event Listeners
actionBtns.forEach(btn => {
    btn.addEventListener('click', function () {
        const item = this.dataset.item;
        const type = this.dataset.type;
        const tma = parseInt(this.dataset.tma, 10) || 0;
        openModal(item, type, tma);
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

    // Reseta saldo e histórico
function resetAll() {
    if (!confirm('Reset time balance and history? This cannot be undone.')) return;
    timeBalance = 0;
    transactions = [];
    saveState();
    updateBalanceDisplay();
    updateHistory();
}

if (resetBtn) resetBtn.addEventListener('click', resetAll);


function endWorkDay() {
    const exportData = {
        exportDate: new Date().toISOString(),
        finalBalance: timeBalance,
        finalBalanceFormatted: secondsToTime(timeBalance),
        transactionCount: transactions.length,
        transactions: transactions
    };

    fetch('http://localhost:3000/save', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(exportData)
    })
    .then(res => res.json())
    .then(data => {
        alert("Dados salvos com sucesso no db.json ✅");
    })
    .catch(err => {
        console.error(err);
        alert("Erro ao salvar ❌");
    });
}


if (endDayBtn) endDayBtn.addEventListener('click', endWorkDay);

// Inicialização
loadState();
updateBalanceDisplay();
updateHistory();
