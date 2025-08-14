// --- Global Değişkenler ---
let cheaters = [];
let authToken = sessionStorage.getItem('stvAuthToken') || null;
let sortColumn = 'createdAt';
let sortDirection = 'desc';
let socket = null;
let editingCheater = null;
let editingHistory = null;
let confirmCallback = null;

const WS_URL = 'wss://stv-backend.onrender.com';
const API_BASE_URL = 'https://stv-backend.onrender.com';

// --- Sayfa Yüklendiğinde Başlat ---
document.addEventListener('DOMContentLoaded', () => {
    setupEventListeners();
    connectWebSocket();
    showWelcomeModal();
    if (authToken) {
        updateAdminUI();
    }
});

// --- Olay Dinleyicileri ---
function setupEventListeners() {
    document.getElementById('closeModalBtn').addEventListener('click', closeWelcomeModal);
    document.getElementById('adminBtn').addEventListener('click', toggleAdminPanel);
    document.getElementById('quickAddBtn').addEventListener('click', showAdminPanel);
    document.getElementById('adminLoginBtn').addEventListener('click', handleAdminLogin);
    document.getElementById('adminCancelBtn').addEventListener('click', closeAdminLoginModal);
    document.getElementById('adminCloseBtn').addEventListener('click', closeAdminPanel);
    document.getElementById('editCancelBtn').addEventListener('click', closeEditModal);
    document.getElementById('confirmYes').addEventListener('click', handleConfirmYes);
    document.getElementById('confirmNo').addEventListener('click', closeConfirmModal);
    document.getElementById('cheaterForm').addEventListener('submit', handleSubmit);
    document.getElementById('editForm').addEventListener('submit', handleEditSubmit);
    document.getElementById('searchInput').addEventListener('input', updateDisplay);
    document.getElementById('adminPassword').addEventListener('keypress', e => { if (e.key === 'Enter') handleAdminLogin(); });
    document.querySelectorAll('.stv-table-header[data-sort]').forEach(th => {
        th.addEventListener('click', () => sortTable(th.dataset.sort));
    });
    document.getElementById('editHistoryForm').addEventListener('submit', handleHistoryEditSubmit);
    document.getElementById('editHistoryCancelBtn').addEventListener('click', closeEditHistoryModal);
}

// --- WebSocket Fonksiyonları ---
function connectWebSocket() {
    showConnectionStatus(true, 'Sunucuya bağlanılıyor...');
    socket = new WebSocket(WS_URL);
    socket.onopen = () => showConnectionStatus(false);
    socket.onclose = () => {
        showConnectionStatus(true, 'Bağlantı kesildi, yeniden deneniyor...');
        setTimeout(connectWebSocket, 5000);
    };
    socket.onerror = () => showConnectionStatus(true, 'Bağlantı hatası!');
    socket.onmessage = event => handleWebSocketMessage(JSON.parse(event.data));
}

function handleWebSocketMessage(message) {
    const { type, data } = message;
    let toastMessage = '';
    let needsUpdate = true;

    switch (type) {
        case 'INITIAL_DATA': cheaters = data; break;
        case 'CHEATER_ADDED': cheaters.unshift(data); toastMessage = `${data.playerName} eklendi.`; break;
        case 'CHEATER_UPDATED': {
            const index = cheaters.findIndex(c => c._id === data._id);
            if (index !== -1) cheaters[index] = data;
            toastMessage = `${data.playerName} güncellendi.`;
            // Eğer geçmişi açıksa, yeniden çiz
            const existingHistoryRow = document.querySelector(`.history-for-${data._id}`);
            if (existingHistoryRow) {
                const mainRow = document.querySelector(`tr[data-id="${data._id}"]`);
                if (mainRow) {
                    const icon = mainRow.querySelector('.history-icon');
                    icon?.classList.remove('rotated');
                    document.querySelectorAll(`.history-for-${data._id}`).forEach(row => row.remove());
                    togglePlayerHistory(mainRow);
                }
            }
            break;
        }
        case 'CHEATER_DELETED': {
            cheaters = cheaters.filter(c => c._id !== data._id);
            toastMessage = `Hileci silindi.`;
            break;
        }
        case 'ERROR_OCCURRED': 
            showToast(data.message, 'error'); 
            needsUpdate = false;
            break;
    }
    
    if (needsUpdate) {
        if (toastMessage) showToast(toastMessage, 'success');
        updateLastUpdateTime();
        updateDisplay();
    }
}

function sendMessage(type, data) {
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type, data, token: authToken }));
        return true;
    }
    showToast('Sunucu bağlantısı yok!', 'error');
    return false;
}

// --- Form Gönderme İşlemleri ---
function handleSubmit(e) {
    e.preventDefault();
    const cheaterData = {
        playerName: document.getElementById('playerName').value.trim(),
        steamId: document.getElementById('steamId').value.trim(),
        steamProfile: document.getElementById('steamProfile').value.trim(),
        serverName: document.getElementById('serverName').value.trim() || "Bilinmiyor",
        cheatTypes: document.getElementById('cheatTypes').value.split(',').map(t => t.trim()).filter(Boolean),
        fungunReport: document.getElementById('fungunReport').value.trim()
    };
    if (!cheaterData.playerName || !cheaterData.steamId) {
        showToast('Oyuncu Adı ve Steam ID zorunludur!', 'error');
        return;
    }
    if (sendMessage('CHEATER_ADDED', cheaterData)) closeAdminPanel();
}

function handleEditSubmit(e) {
    e.preventDefault();
    if (!editingCheater) return;
    const updatedData = {
        _id: editingCheater._id,
        playerName: document.getElementById('editPlayerName').value.trim(),
        steamId: document.getElementById('editSteamId').value.trim(),
        steamProfile: document.getElementById('editSteamProfile').value.trim(),
        serverName: document.getElementById('editServerName').value.trim() || "Bilinmiyor",
        detectionCount: parseInt(document.getElementById('editDetectionCount').value),
        cheatTypes: document.getElementById('editCheatTypes').value.split(',').map(t => t.trim()).filter(Boolean),
        fungunReport: document.getElementById('editFungunReport').value.trim()
    };
    if (sendMessage('CHEATER_UPDATED', updatedData)) closeEditModal();
}

function handleHistoryEditSubmit(e) {
    e.preventDefault();
    if (!editingHistory) return;
    const updatedHistoryData = {
        playerName: document.getElementById('editHistoryPlayerName').value.trim(),
        steamId: document.getElementById('editHistorySteamId').value.trim(),
        steamProfile: document.getElementById('editHistorySteamProfile').value.trim(),
        serverName: document.getElementById('editHistoryServerName').value.trim(),
        cheatTypes: document.getElementById('editHistoryCheatTypes').value.split(',').map(t => t.trim()).filter(Boolean),
        fungunReport: document.getElementById('editHistoryFungunReport').value.trim()
    };
    sendMessage('HISTORY_ENTRY_UPDATED', {
        cheaterId: editingHistory.cheaterId,
        historyId: editingHistory.historyId,
        updatedHistoryData
    });
    closeEditHistoryModal();
}

// --- CRUD Buton Fonksiyonları ---
function showEditModal(cheaterId) {
    editingCheater = cheaters.find(c => c._id === cheaterId);
    if (!editingCheater) return;
    document.getElementById('editPlayerName').value = editingCheater.playerName;
    document.getElementById('editSteamId').value = editingCheater.steamId;
    document.getElementById('editSteamProfile').value = editingCheater.steamProfile || '';
    document.getElementById('editServerName').value = editingCheater.serverName;
    document.getElementById('editDetectionCount').value = editingCheater.detectionCount;
    document.getElementById('editCheatTypes').value = (editingCheater.cheatTypes || []).join(', ');
    document.getElementById('editFungunReport').value = editingCheater.fungunReport || '';
    document.getElementById('editModal').style.display = 'flex';
}

function deleteCheater(cheaterId) {
    const cheater = cheaters.find(c => c._id === cheaterId);
    if (!cheater) return;
    showConfirmModal(`'${cheater.playerName}' adlı ana kayıt silinecek. Tüm geçmişi de silinir. Emin misiniz?`, () => {
        sendMessage('CHEATER_DELETED', { _id: cheaterId });
    });
}

function deleteHistoryEntry(cheaterId, historyId) {
    showConfirmModal('Bu tespit geçmişi kaydı kalıcı olarak silinecek. Emin misiniz?', () => {
        sendMessage('HISTORY_ENTRY_DELETED', { cheaterId, historyId });
    });
}

function editHistoryEntry(cheaterId, historyId) {
    const cheater = cheaters.find(c => c._id === cheaterId);
    if (!cheater) return;
    const historyEntry = cheater.history.find(h => h._id === historyId);
    if (!historyEntry) return;
    editingHistory = { cheaterId, historyId };
    document.getElementById('editHistoryPlayerName').value = historyEntry.playerName || cheater.playerName;
    document.getElementById('editHistorySteamId').value = historyEntry.steamId || cheater.steamId;
    document.getElementById('editHistorySteamProfile').value = historyEntry.steamProfile || cheater.steamProfile || '';
    document.getElementById('editHistoryServerName').value = historyEntry.serverName || '';
    document.getElementById('editHistoryCheatTypes').value = (historyEntry.cheatTypes || []).join(', ');
    document.getElementById('editHistoryFungunReport').value = historyEntry.fungunReport || '';
    document.getElementById('editHistoryModal').style.display = 'flex';
}

function togglePlayerHistory(rowElement) {
    const cheaterId = rowElement.dataset.id;
    const icon = rowElement.querySelector('.history-icon');
    const isLoggedIn = !!authToken;
    
    const currentlyOpen = document.querySelectorAll(`.history-for-${cheaterId}`);
    if (currentlyOpen.length > 0) {
        currentlyOpen.forEach(row => row.remove());
        icon?.classList.remove('rotated');
        return;
    }

    document.querySelectorAll('.stv-history-row').forEach(row => row.remove());
    document.querySelectorAll('.history-icon.rotated').forEach(i => i.classList.remove('rotated'));

    const cheater = cheaters.find(c => c._id === cheaterId);
    if (!cheater || !cheater.history || cheater.history.length === 0) {
        showToast('Bu oyuncu için geçmiş tespit kaydı bulunmuyor.', 'info');
        return;
    }
    
    icon?.classList.add('rotated');
    const historyRowsHTML = cheater.history.map(item => {
        const itemDate = new Date(item.date).toLocaleString('tr-TR');
        const playerName = item.playerName || cheater.playerName;
        const steamId = item.steamId || cheater.steamId;
        const steamProfile = item.steamProfile || cheater.steamProfile;
        const itemServer = item.serverName || 'Bilinmiyor';
        const itemCheats = (item.cheatTypes || []).map(type => `<span class="stv-cheat-type">${type}</span>`).join('');
        const fungunReport = item.fungunReport || cheater.fungunReport;
        
        const adminActionsHTML = isLoggedIn ? `
            <td class="p-3">
                <div class="stv-action-buttons">
                    <button onclick="editHistoryEntry('${cheater._id}', '${item._id}')" class="stv-action-btn stv-edit-btn" title="Bu Tespiti Düzenle"><i class="fas fa-edit"></i></button>
                    <button onclick="deleteHistoryEntry('${cheater._id}', '${item._id}')" class="stv-action-btn stv-delete-btn" title="Bu Tespiti Sil"><i class="fas fa-trash"></i></button>
                </div>
            </td>` : '';
        return `
            <tr class="stv-table-row stv-history-row history-for-${cheaterId}" data-history-id="${item._id}">
                <td class="p-3">${playerName}<span class="stv-history-date-small">${itemDate}</span></td>
                <td class="p-3"><code>${steamId}</code></td>
                <td class="p-3">${steamProfile ? `<a href="${steamProfile}" target="_blank" class="text-blue-400 hover:underline">Profil</a>` : 'Yok'}</td>
                <td class="p-3">${itemServer}</td>
                <td class="p-3">-</td>
                <td class="p-3">${itemCheats}</td>
                <td class="p-3">${(fungunReport || '').split(',').map(link => `<a href="${link}" target="_blank" class="text-red-400 hover:underline block">Rapor</a>`).join('') || 'Yok'}</td>
                ${adminActionsHTML}
            </tr>`;
    }).join('');
    
    rowElement.insertAdjacentHTML('afterend', historyRowsHTML);
}

// --- Modal Kontrol Fonksiyonları ---
function showWelcomeModal() { document.getElementById('welcomeModal').style.display = 'flex'; }
function closeWelcomeModal() { document.getElementById('welcomeModal').style.display = 'none'; }
function toggleAdminPanel() { authToken ? showAdminPanel() : showAdminLoginModal(); }
function showAdminLoginModal() { document.getElementById('adminLoginModal').style.display = 'flex'; document.getElementById('adminPassword').focus(); }
function closeAdminLoginModal() { document.getElementById('adminLoginModal').style.display = 'none'; document.getElementById('adminPassword').value = ''; }
function showAdminPanel() { document.getElementById('adminPanelModal').style.display = 'flex'; document.getElementById('cheaterForm').reset(); }
function closeAdminPanel() { document.getElementById('adminPanelModal').style.display = 'none'; }
function closeEditModal() { document.getElementById('editModal').style.display = 'none'; editingCheater = null; }
function closeEditHistoryModal() { document.getElementById('editHistoryModal').style.display = 'none'; editingHistory = null; }
function showConfirmModal(message, callback) { document.getElementById('confirmMessage').textContent = message; document.getElementById('confirmModal').style.display = 'flex'; confirmCallback = callback; }
function closeConfirmModal() { document.getElementById('confirmModal').style.display = 'none'; confirmCallback = null; }
function handleConfirmYes() { if (confirmCallback) { confirmCallback(); } closeConfirmModal(); }

// --- Admin Giriş Fonksiyonları (Sunucuya Bağlı) ---
async function handleAdminLogin() {
    const password = document.getElementById('adminPassword').value;
    if (!password) {
        showToast('Lütfen şifreyi girin.', 'error');
        return;
    }
    try {
        const response = await fetch(`${API_BASE_URL}/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: password })
        });
        const result = await response.json();
        if (response.ok && result.token) {
            authToken = result.token;
            sessionStorage.setItem('stvAuthToken', authToken);
            closeAdminLoginModal();
            updateAdminUI();
            showToast('Giriş başarılı!', 'success');
        } else {
            showToast(result.message || 'Hatalı şifre!', 'error');
        }
    } catch (error) {
        showToast('Giriş yapılırken bir sunucu hatası oluştu.', 'error');
        console.error('Login Error:', error);
    }
}

function updateAdminUI() {
    const isLoggedIn = !!authToken;
    document.getElementById('adminBtn').innerHTML = `<i class="fas fa-user-shield mr-2"></i> ${isLoggedIn ? 'Admin ✓' : 'Admin'}`;
    document.getElementById('quickAddBtn').style.display = isLoggedIn ? 'flex' : 'none';
    document.getElementById('actionsHeader').style.display = isLoggedIn ? 'table-cell' : 'none';
    updateDisplay();
}

// --- Arayüz Güncelleme ve Yardımcı Fonksiyonlar ---
function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.style.cssText = `position: fixed; top: 20px; right: 20px; background: ${type === 'error' ? '#b91c1c' : type === 'success' ? '#16a34a' : '#2563eb'}; color: white; padding: 14px 22px; border-radius: 8px; z-index: 10001; font-weight: 500; box-shadow: 0 5px 15px rgba(0,0,0,0.3); transform: translateX(120%); transition: transform 0.4s ease;`;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => { toast.style.transform = 'translateX(0)'; }, 100);
    setTimeout(() => {
        toast.style.transform = 'translateX(120%)';
        setTimeout(() => { if (document.body.contains(toast)) document.body.removeChild(toast); }, 400);
    }, 4000);
}
function showConnectionStatus(isConnecting, message = '') {
    const statusDiv = document.getElementById('connectionStatus');
    statusDiv.style.display = isConnecting ? 'block' : 'none';
    if (isConnecting) statusDiv.innerHTML = `<div class="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-yellow-900/20 text-yellow-400 border border-yellow-500/30">${message}</div>`;
}
function updateLastUpdateTime() { document.getElementById('lastUpdateTime').textContent = new Date().toLocaleString('tr-TR'); }

// --- Tablo Sıralama ve Görüntüleme ---
function sortTable(column) {
    if (sortColumn === column) {
        sortDirection = sortDirection === 'desc' ? 'asc' : 'desc';
    } else {
        sortColumn = column;
        sortDirection = 'desc';
    }
    updateDisplay();
}

function updateDisplay() {
    const tableBody = document.getElementById('cheaterTableBody');
    const searchTerm = document.getElementById('searchInput').value.toLowerCase();
    const isLoggedIn = !!authToken;
    
    let filteredCheaters = cheaters.filter(c =>
        (c.playerName && c.playerName.toLowerCase().includes(searchTerm)) ||
        (c.steamId && c.steamId.toLowerCase().includes(searchTerm))
    );

    filteredCheaters.sort((a, b) => {
        const aVal = a[sortColumn] || '';
        const bVal = b[sortColumn] || '';
        const comparison = String(aVal).localeCompare(String(bVal), undefined, {numeric: true});
        return sortDirection === 'asc' ? comparison : -comparison;
    });

    const colSpan = isLoggedIn ? 8 : 7;
    document.getElementById('actionsHeader').style.display = isLoggedIn ? 'table-cell' : 'none';
    if (filteredCheaters.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="${colSpan}" class="text-center py-10 text-gray-400">Yükleniyor veya kayıt bulunamadı...</td></tr>`;
    } else {
        tableBody.innerHTML = filteredCheaters.map(cheater => `
            <tr class="stv-table-row" data-id="${cheater._id}">
                <td class="p-3">
                    <span class="stv-player-name ${cheater.history && cheater.history.length > 0 ? 'clickable' : ''}" ${cheater.history && cheater.history.length > 0 ? `onclick="togglePlayerHistory(this.closest('tr'))"` : ''}>
                        ${cheater.playerName}
                        ${cheater.history && cheater.history.length > 0 ? `<i class="fas fa-chevron-down ml-2 history-icon"></i>` : ''}
                    </span>
                </td>
                <td class="p-3"><code>${cheater.steamId}</code></td>
                <td class="p-3">${cheater.steamProfile ? `<a href="${cheater.steamProfile}" target="_blank" class="text-blue-400 hover:underline">Profil</a>` : 'Yok'}</td>
                <td class="p-3">${cheater.serverName}</td>
                <td class="p-3"><span class="stv-detection-count">${cheater.detectionCount}</span></td>
                <td class="p-3">${(cheater.cheatTypes || []).map(type => `<span class="stv-cheat-type">${type}</span>`).join('')}</td>
                <td class="p-3">${(cheater.fungunReport || '').split(',').map(link => link.trim()).filter(Boolean).map(link => `<a href="${link}" target="_blank" class="text-red-400 hover:underline block">Rapor</a>`).join('') || 'Yok'}</td>
                ${isLoggedIn ? `
                    <td class="p-3">
                        <div class="stv-action-buttons">
                            <button onclick="showEditModal('${cheater._id}')" class="stv-action-btn stv-edit-btn" title="Düzenle"><i class="fas fa-edit"></i></button>
                            <button onclick="deleteCheater('${cheater._id}')" class="stv-action-btn stv-delete-btn" title="Sil"><i class="fas fa-trash"></i></button>
                        </div>
                    </td>
                ` : ''}
            </tr>
        `).join('');
    }
    document.getElementById('cheaterCountDisplay').textContent = cheaters.length;
}
